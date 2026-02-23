'use strict';

window.ShadowLog = window.ShadowLog || {};

(() => {
  const { Constants } = window.ShadowLog;
  const { Storage } = window.ShadowLog;
  const { RulesEngine } = window.ShadowLog;
  const { DeletionEngine } = window.ShadowLog;
  const { Buffer } = window.ShadowLog;
  const { TabTracker } = window.ShadowLog;
  const { Scheduler } = window.ShadowLog;

  // --- Rate limiter (token bucket) ---
  const rateLimiter = {
    tokens: Constants.DEFAULT_MAX_DELETES_PER_MINUTE,
    lastRefill: Date.now(),

    acquire(maxPerMinute) {
      const now = Date.now();
      if (now - this.lastRefill >= 60000) {
        this.tokens = maxPerMinute || Constants.DEFAULT_MAX_DELETES_PER_MINUTE;
        this.lastRefill = now;
      }
      if (this.tokens > 0) {
        this.tokens--;
        return true;
      }
      return false;
    },
  };

  // --- Deduplication (recently processed URLs) ---
  const recentlyProcessed = new Map(); // url -> timestamp

  function wasRecentlyProcessed(url) {
    const ts = recentlyProcessed.get(url);
    if (ts && Date.now() - ts < Constants.DEDUP_WINDOW_MS) {
      return true;
    }
    return false;
  }

  function markProcessed(url) {
    recentlyProcessed.set(url, Date.now());
    // Prune old entries periodically
    if (recentlyProcessed.size > 500) {
      const cutoff = Date.now() - Constants.DEDUP_WINDOW_MS;
      for (const [key, val] of recentlyProcessed) {
        if (val < cutoff) recentlyProcessed.delete(key);
      }
    }
  }

  // --- Action log ---
  async function logAction(entry) {
    await Storage.updateLocal(Constants.STORAGE_KEY_ACTION_LOG, (log) => {
      log = log || [];
      log.unshift({
        timestamp: Date.now(),
        url: entry.url,
        ruleNames: entry.ruleNames || [],
        actions: entry.actions,
        result: entry.result,
      });
      // Trim to max
      if (log.length > Constants.ACTION_LOG_MAX_ENTRIES) {
        log.length = Constants.ACTION_LOG_MAX_ENTRIES;
      }
      return log;
    });
  }

  // --- Core deletion pipeline ---
  async function processDeletion(url, trigger) {
    const paused = await Storage.getSession(Constants.SESSION_KEY_PAUSED, false);
    if (paused) return;

    if (wasRecentlyProcessed(url)) return;

    const matches = RulesEngine.evaluateUrl(url);
    if (matches.length === 0) return;

    const mergedTiming = RulesEngine.mergeTiming(matches);

    // Check if this trigger type is enabled for the matched rules
    if (trigger === 'asap' && !mergedTiming.asap) return;
    if (trigger === 'tabClose' && !mergedTiming.onTabClose) return;
    if (trigger === 'browserClose' && !mergedTiming.onBrowserClose) return;

    const mergedActions = RulesEngine.mergeActions(matches);
    const ruleNames = matches.map(m => m.ruleName);

    // Rate limit check
    const minRate = Math.min(...matches.map(m => m.safety.maxDeletesPerMinute));
    if (!rateLimiter.acquire(minRate)) {
      // Over rate limit — enqueue to buffer instead
      console.log(`ShadowLog: rate limited, buffering ${url}`);
      await Buffer.enqueue({
        url,
        hostname: DeletionEngine.extractHostname(url),
        actions: mergedActions,
        ruleIdMatched: matches[0].ruleId,
      });
      return;
    }

    markProcessed(url);

    const result = await DeletionEngine.executeActions(url, mergedActions);

    await logAction({ url, ruleNames, actions: mergedActions, result });

    if (!result.success) {
      // Enqueue failed deletion to buffer for retry
      await Buffer.enqueue({
        url,
        hostname: DeletionEngine.extractHostname(url),
        actions: mergedActions,
        ruleIdMatched: matches[0].ruleId,
      });
    }

    console.log(`ShadowLog [${trigger}]: ${result.success ? 'deleted' : 'buffered'} ${url} (rules: ${ruleNames.join(', ')})`);
  }

  // --- Event handlers ---

  function handleVisited(historyItem) {
    if (!historyItem.url) return;
    // Skip internal pages
    if (historyItem.url.startsWith('about:') || historyItem.url.startsWith('moz-extension:')) return;

    processDeletion(historyItem.url, 'asap');
  }

  function handleNavigation(details) {
    if (details.frameId !== 0) return; // top-level only
    if (!details.url) return;
    if (details.url.startsWith('about:') || details.url.startsWith('moz-extension:')) return;

    // Update tab tracker
    TabTracker.trackNavigation(details.tabId, details.url);

    // Secondary ASAP trigger (in case history.onVisited is delayed)
    processDeletion(details.url, 'asap');
  }

  async function handleTabRemoved(tabId, removeInfo) {
    const url = await TabTracker.getTabUrl(tabId);
    await TabTracker.removeTab(tabId);

    if (url) {
      await processDeletion(url, 'tabClose');
    }
  }

  async function handleWindowRemoved(windowId) {
    try {
      const remainingWindows = await browser.windows.getAll();
      if (remainingWindows.length === 0) {
        console.log('ShadowLog: last window closing — flushing pending');
        await Buffer.flush();

        // Run browserClose timing rules for all tracked tabs
        const tracked = await TabTracker.getAllTracked();
        for (const [tabId, entry] of Object.entries(tracked)) {
          if (entry.url) {
            await processDeletion(entry.url, 'browserClose');
          }
        }
      }
    } catch (err) {
      console.error('ShadowLog: error in handleWindowRemoved:', err);
    }
  }

  function handleStorageChanged(changes, area) {
    if (area === 'local' && changes[Constants.STORAGE_KEY_RULES]) {
      console.log('ShadowLog: rules changed, reloading');
      RulesEngine.loadRules().then(() => {
        const allRules = changes[Constants.STORAGE_KEY_RULES].newValue || [];
        Scheduler.syncAlarms(allRules);
      });
    }
  }

  async function handleMessage(message, sender) {
    switch (message.type) {
      case 'GET_STATUS': {
        const paused = await Storage.getSession(Constants.SESSION_KEY_PAUSED, false);
        const bufferStats = await Buffer.getStats();
        const rules = await Storage.getLocal(Constants.STORAGE_KEY_RULES, []);
        return {
          paused,
          bufferStats,
          ruleCount: rules.length,
          activeRuleCount: rules.filter(r => r.enabled).length,
        };
      }

      case 'SET_PAUSED': {
        await Storage.setSession(Constants.SESSION_KEY_PAUSED, !!message.value);
        console.log(`ShadowLog: ${message.value ? 'paused' : 'resumed'}`);
        return { ok: true };
      }

      case 'FORGET_URL': {
        if (!message.url) return { ok: false, error: 'No URL provided' };
        const forgetActions = { history: 'delete', cookies: 'delete', cache: 'keep', siteData: 'delete' };
        const result = await DeletionEngine.executeActions(message.url, forgetActions);
        await logAction({
          url: message.url,
          ruleNames: ['Manual forget'],
          actions: forgetActions,
          result,
        });
        return { ok: result.success, result };
      }

      case 'GET_ACTION_LOG': {
        const log = await Storage.getLocal(Constants.STORAGE_KEY_ACTION_LOG, []);
        const limit = message.limit || 20;
        return log.slice(0, limit);
      }

      case 'TEST_URL': {
        if (!message.url) return { matches: [], actions: null };
        // Temporarily ensure rules are loaded
        await RulesEngine.loadRules();
        const matches = RulesEngine.evaluateUrl(message.url);
        const mergedActions = matches.length > 0 ? RulesEngine.mergeActions(matches) : null;
        const mergedTiming = matches.length > 0 ? RulesEngine.mergeTiming(matches) : null;
        const hostname = DeletionEngine.extractHostname(message.url);
        const hostnames = hostname ? DeletionEngine.expandHostnames(hostname) : [];
        return { matches, mergedActions, mergedTiming, hostname, hostnames };
      }

      case 'CLEAR_ACTION_LOG': {
        await Storage.setLocal(Constants.STORAGE_KEY_ACTION_LOG, []);
        return { ok: true };
      }

      case 'CLEAR_BUFFER': {
        await Buffer.clear();
        return { ok: true };
      }

      default:
        return { error: 'Unknown message type' };
    }
  }

  // --- Bootstrap ---

  async function bootstrap() {
    console.log('ShadowLog: bootstrapping...');

    // Load rules
    await RulesEngine.loadRules();

    // Trim and flush buffer from previous sessions
    await Buffer.trimExpired();
    await Buffer.flush();

    // Sync alarms
    const rules = await Storage.getLocal(Constants.STORAGE_KEY_RULES, []);
    await Scheduler.syncAlarms(rules);
    await Scheduler.ensureBufferFlushAlarm();

    console.log('ShadowLog: bootstrap complete');
  }

  // --- Register all listeners ---

  browser.history.onVisited.addListener(handleVisited);

  browser.webNavigation.onCommitted.addListener(handleNavigation);

  browser.tabs.onRemoved.addListener(handleTabRemoved);

  browser.windows.onRemoved.addListener(handleWindowRemoved);

  browser.alarms.onAlarm.addListener((alarm) => {
    Scheduler.handleAlarm(alarm);
  });

  browser.storage.onChanged.addListener(handleStorageChanged);

  browser.runtime.onMessage.addListener((message, sender) => {
    // Return a promise for async responses
    return handleMessage(message, sender);
  });

  browser.runtime.onStartup.addListener(() => {
    console.log('ShadowLog: onStartup');
    bootstrap();
  });

  browser.runtime.onInstalled.addListener((details) => {
    console.log(`ShadowLog: onInstalled (${details.reason})`);
    if (details.reason === 'install') {
      // Initialize default settings
      Storage.setLocal(Constants.STORAGE_KEY_RULES, []);
      Storage.setLocal(Constants.STORAGE_KEY_ACTION_LOG, []);
    }
    bootstrap();
  });

  // Also bootstrap immediately when the background script loads
  // (handles temporary extension loading via about:debugging)
  bootstrap();

})();
