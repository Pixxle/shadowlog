'use strict';

const { createBrowserMock, installBrowserMock } = require('../helpers/browser-mock');
const { loadAllBackgroundModules, loadMainModule, ensurePolyfills, clearAllModules } = require('../helpers/module-loader');

// Flush microtasks so fire-and-forget async chains can settle.
// Uses Promise.resolve (microtask-based) rather than setTimeout to avoid
// interaction with jest fake timers.
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('main.js (background entry point)', () => {
  let bm;

  beforeEach(async () => {
    ensurePolyfills();
    bm = installBrowserMock(createBrowserMock());
    window.ShadowLog = {};
    loadAllBackgroundModules();
    // Seed empty rules so bootstrap doesn't fail
    bm._localStore.shadowlog_rules = [];
    bm._localStore.shadowlog_buffer = [];
    bm._localStore.shadowlog_action_log = [];
    loadMainModule();
    // Let bootstrap() settle with real timers, then enable fakes for Date.now
    await settle();
    jest.useFakeTimers({ legacyFakeTimers: false });
  });

  afterEach(() => {
    jest.useRealTimers();
    clearAllModules();
  });

  describe('listener registration', () => {
    it('should register a listener on browser.history.onVisited', () => {
      expect(bm.history.onVisited.addListener).toHaveBeenCalled();
    });

    it('should register a listener on browser.webNavigation.onCommitted', () => {
      expect(bm.webNavigation.onCommitted.addListener).toHaveBeenCalled();
    });

    it('should register a listener on browser.tabs.onRemoved', () => {
      expect(bm.tabs.onRemoved.addListener).toHaveBeenCalled();
    });

    it('should register a listener on browser.windows.onRemoved', () => {
      expect(bm.windows.onRemoved.addListener).toHaveBeenCalled();
    });

    it('should register a listener on browser.alarms.onAlarm', () => {
      expect(bm.alarms.onAlarm.addListener).toHaveBeenCalled();
    });

    it('should register a listener on browser.storage.onChanged', () => {
      expect(bm.storage.onChanged.addListener).toHaveBeenCalled();
    });

    it('should register a listener on browser.runtime.onMessage', () => {
      expect(bm.runtime.onMessage.addListener).toHaveBeenCalled();
    });

    it('should register a listener on browser.runtime.onStartup', () => {
      expect(bm.runtime.onStartup.addListener).toHaveBeenCalled();
    });

    it('should register a listener on browser.runtime.onInstalled', () => {
      expect(bm.runtime.onInstalled.addListener).toHaveBeenCalled();
    });
  });

  describe('handleMessage — GET_STATUS', () => {
    it('should return paused state, buffer stats, and rule counts', async () => {
      bm._localStore.shadowlog_rules = [
        { id: '1', name: 'A', enabled: true, match: { urlRegex: ['a'] }, actions: { history: 'delete' }, timing: { asap: true }, safety: { maxDeletesPerMinute: 60, cooldownSeconds: 0 } },
        { id: '2', name: 'B', enabled: false, match: { urlRegex: ['b'] }, actions: { history: 'delete' }, timing: { asap: true }, safety: { maxDeletesPerMinute: 60, cooldownSeconds: 0 } },
      ];
      const handler = bm.runtime.onMessage._listeners[0];
      const result = await handler({ type: 'GET_STATUS' }, {});
      expect(result.paused).toBe(false);
      expect(result.ruleCount).toBe(2);
      expect(result.activeRuleCount).toBe(1);
      expect(result.bufferStats).toBeDefined();
      expect(result.bufferStats.total).toBe(0);
    });
  });

  describe('handleMessage — SET_PAUSED', () => {
    it('should set the paused flag to true', async () => {
      const handler = bm.runtime.onMessage._listeners[0];
      const result = await handler({ type: 'SET_PAUSED', value: true }, {});
      expect(result.ok).toBe(true);
      expect(bm._sessionStore.shadowlog_paused).toBe(true);
    });

    it('should set the paused flag to false', async () => {
      bm._sessionStore.shadowlog_paused = true;
      const handler = bm.runtime.onMessage._listeners[0];
      const result = await handler({ type: 'SET_PAUSED', value: false }, {});
      expect(result.ok).toBe(true);
      expect(bm._sessionStore.shadowlog_paused).toBe(false);
    });
  });

  describe('handleMessage — FORGET_URL', () => {
    it('should delete history and site data for the given URL', async () => {
      const handler = bm.runtime.onMessage._listeners[0];
      const result = await handler({ type: 'FORGET_URL', url: 'https://example.com/page' }, {});
      expect(result.ok).toBe(true);
      expect(bm.history.deleteUrl).toHaveBeenCalledWith({ url: 'https://example.com/page' });
    });

    it('should return error when no URL provided', async () => {
      const handler = bm.runtime.onMessage._listeners[0];
      const result = await handler({ type: 'FORGET_URL' }, {});
      expect(result.ok).toBe(false);
      expect(result.error).toBe('No URL provided');
    });

    it('should log the action', async () => {
      const handler = bm.runtime.onMessage._listeners[0];
      await handler({ type: 'FORGET_URL', url: 'https://example.com' }, {});
      const log = bm._localStore.shadowlog_action_log;
      expect(log.length).toBeGreaterThan(0);
      expect(log[0].ruleNames).toEqual(['Manual forget']);
    });
  });

  describe('handleMessage — GET_ACTION_LOG', () => {
    it('should return up to the specified limit', async () => {
      bm._localStore.shadowlog_action_log = Array.from({ length: 50 }, (_, i) => ({ url: `u${i}` }));
      const handler = bm.runtime.onMessage._listeners[0];
      const result = await handler({ type: 'GET_ACTION_LOG', limit: 10 }, {});
      expect(result.length).toBe(10);
    });

    it('should default to 20 entries', async () => {
      bm._localStore.shadowlog_action_log = Array.from({ length: 50 }, (_, i) => ({ url: `u${i}` }));
      const handler = bm.runtime.onMessage._listeners[0];
      const result = await handler({ type: 'GET_ACTION_LOG' }, {});
      expect(result.length).toBe(20);
    });

    it('should return empty array when log is empty', async () => {
      const handler = bm.runtime.onMessage._listeners[0];
      const result = await handler({ type: 'GET_ACTION_LOG' }, {});
      expect(result).toEqual([]);
    });
  });

  describe('handleMessage — TEST_URL', () => {
    it('should return matches for a URL matching a rule', async () => {
      bm._localStore.shadowlog_rules = [{
        id: 'r1', name: 'Test', enabled: true,
        match: { urlRegex: ['example\\.com'], excludeRegex: [] },
        actions: { history: 'delete', cookies: 'keep', cache: 'keep', siteData: 'keep' },
        timing: { asap: true, onTabClose: false, onBrowserClose: false, periodicMinutes: null },
        safety: { maxDeletesPerMinute: 60, cooldownSeconds: 0 },
      }];
      const handler = bm.runtime.onMessage._listeners[0];
      const result = await handler({ type: 'TEST_URL', url: 'https://example.com/page' }, {});
      expect(result.matches.length).toBe(1);
      expect(result.mergedActions.history).toBe('delete');
      expect(result.hostname).toBe('example.com');
      expect(result.hostnames).toContain('example.com');
    });

    it('should return empty matches for non-matching URL', async () => {
      bm._localStore.shadowlog_rules = [{
        id: 'r1', name: 'Test', enabled: true,
        match: { urlRegex: ['example\\.com'], excludeRegex: [] },
        actions: { history: 'delete', cookies: 'keep', cache: 'keep', siteData: 'keep' },
        timing: { asap: true, onTabClose: false, onBrowserClose: false, periodicMinutes: null },
        safety: { maxDeletesPerMinute: 60, cooldownSeconds: 0 },
      }];
      const handler = bm.runtime.onMessage._listeners[0];
      const result = await handler({ type: 'TEST_URL', url: 'https://google.com' }, {});
      expect(result.matches.length).toBe(0);
      expect(result.mergedActions).toBeNull();
    });

    it('should return empty matches when no URL provided', async () => {
      const handler = bm.runtime.onMessage._listeners[0];
      const result = await handler({ type: 'TEST_URL' }, {});
      expect(result.matches).toEqual([]);
    });
  });

  describe('handleMessage — CLEAR_ACTION_LOG', () => {
    it('should clear the action log', async () => {
      bm._localStore.shadowlog_action_log = [{ url: 'x' }];
      const handler = bm.runtime.onMessage._listeners[0];
      const result = await handler({ type: 'CLEAR_ACTION_LOG' }, {});
      expect(result.ok).toBe(true);
      expect(bm._localStore.shadowlog_action_log).toEqual([]);
    });
  });

  describe('handleMessage — CLEAR_BUFFER', () => {
    it('should clear the buffer', async () => {
      bm._localStore.shadowlog_buffer = [{ id: '1', url: 'x', status: 'pending' }];
      const handler = bm.runtime.onMessage._listeners[0];
      const result = await handler({ type: 'CLEAR_BUFFER' }, {});
      expect(result.ok).toBe(true);
      expect(bm._localStore.shadowlog_buffer).toEqual([]);
    });
  });

  describe('handleMessage — unknown type', () => {
    it('should return error for unknown message type', async () => {
      const handler = bm.runtime.onMessage._listeners[0];
      const result = await handler({ type: 'BOGUS' }, {});
      expect(result.error).toBe('Unknown message type');
    });
  });

  describe('handleVisited (via history.onVisited)', () => {
    beforeEach(async () => {
      // Seed a matching rule
      bm._localStore.shadowlog_rules = [{
        id: 'r1', name: 'Block Example', enabled: true,
        match: { urlRegex: ['example\\.com'], excludeRegex: [] },
        actions: { history: 'delete', cookies: 'keep', cache: 'keep', siteData: 'keep' },
        timing: { asap: true, onTabClose: false, onBrowserClose: false, periodicMinutes: null },
        safety: { maxDeletesPerMinute: 60, cooldownSeconds: 0 },
      }];
      // Reload rules
      await window.ShadowLog.RulesEngine.loadRules();
    });

    it('should delete history for a matching URL', async () => {
      bm.history.onVisited._fire({ url: 'https://example.com/page' });
      await settle();
      expect(bm.history.deleteUrl).toHaveBeenCalledWith({ url: 'https://example.com/page' });
    });

    it('should skip URLs with no url property', async () => {
      bm.history.deleteUrl.mockClear();
      bm.history.onVisited._fire({});
      await settle();
      expect(bm.history.deleteUrl).not.toHaveBeenCalled();
    });

    it('should skip about: URLs', async () => {
      bm.history.deleteUrl.mockClear();
      bm.history.onVisited._fire({ url: 'about:blank' });
      await settle();
      expect(bm.history.deleteUrl).not.toHaveBeenCalled();
    });

    it('should skip moz-extension: URLs', async () => {
      bm.history.deleteUrl.mockClear();
      bm.history.onVisited._fire({ url: 'moz-extension://abc/page.html' });
      await settle();
      expect(bm.history.deleteUrl).not.toHaveBeenCalled();
    });

    it('should not process when paused', async () => {
      bm._sessionStore.shadowlog_paused = true;
      bm.history.deleteUrl.mockClear();
      bm.history.onVisited._fire({ url: 'https://example.com/new' });
      await settle();
      expect(bm.history.deleteUrl).not.toHaveBeenCalled();
    });

    it('should not process non-matching URLs', async () => {
      bm.history.deleteUrl.mockClear();
      bm.history.onVisited._fire({ url: 'https://google.com' });
      await settle();
      expect(bm.history.deleteUrl).not.toHaveBeenCalled();
    });
  });

  describe('handleNavigation (via webNavigation.onCommitted)', () => {
    it('should track top-level navigations', async () => {
      bm.webNavigation.onCommitted._fire({ frameId: 0, tabId: 42, url: 'https://google.com' });
      await settle();
      const url = await window.ShadowLog.TabTracker.getTabUrl(42);
      expect(url).toBe('https://google.com');
    });

    it('should ignore non-top-level frames', async () => {
      bm.webNavigation.onCommitted._fire({ frameId: 1, tabId: 42, url: 'https://ads.com' });
      await settle();
      const url = await window.ShadowLog.TabTracker.getTabUrl(42);
      expect(url).toBeNull();
    });

    it('should skip about: URLs', async () => {
      bm.webNavigation.onCommitted._fire({ frameId: 0, tabId: 42, url: 'about:blank' });
      await settle();
      const url = await window.ShadowLog.TabTracker.getTabUrl(42);
      expect(url).toBeNull();
    });
  });

  describe('handleTabRemoved (via tabs.onRemoved)', () => {
    it('should process tabClose deletion for tracked tabs', async () => {
      // Set up rule with onTabClose
      bm._localStore.shadowlog_rules = [{
        id: 'r1', name: 'OnClose', enabled: true,
        match: { urlRegex: ['example\\.com'], excludeRegex: [] },
        actions: { history: 'delete', cookies: 'keep', cache: 'keep', siteData: 'keep' },
        timing: { asap: false, onTabClose: true, onBrowserClose: false, periodicMinutes: null },
        safety: { maxDeletesPerMinute: 60, cooldownSeconds: 0 },
      }];
      await window.ShadowLog.RulesEngine.loadRules();

      // Track a tab
      await window.ShadowLog.TabTracker.trackNavigation(99, 'https://example.com/page');
      bm.history.deleteUrl.mockClear();

      // Fire tab removed
      bm.tabs.onRemoved._fire(99, { windowId: 1, isWindowClosing: false });
      await settle();

      expect(bm.history.deleteUrl).toHaveBeenCalledWith({ url: 'https://example.com/page' });
    });

    it('should remove the tab from tracker', async () => {
      await window.ShadowLog.TabTracker.trackNavigation(99, 'https://example.com');
      bm.tabs.onRemoved._fire(99, { windowId: 1, isWindowClosing: false });
      await settle();
      const url = await window.ShadowLog.TabTracker.getTabUrl(99);
      expect(url).toBeNull();
    });
  });

  describe('handleWindowRemoved (via windows.onRemoved)', () => {
    it('should flush buffer when last window closes', async () => {
      // Seed buffer with an entry
      bm._localStore.shadowlog_buffer = [{
        id: 'b1', url: 'https://x.com', hostname: 'x.com',
        actions: { history: 'delete', cookies: 'keep', cache: 'keep', siteData: 'keep' },
        firstSeenAt: Date.now(), lastAttemptAt: null, attempts: 0, status: 'pending',
      }];
      bm.windows.getAll.mockResolvedValue([]);

      bm.history.deleteUrl.mockClear();
      bm.windows.onRemoved._fire(1);
      await settle();

      // Buffer flush should have attempted deletion
      expect(bm.history.deleteUrl).toHaveBeenCalled();
    });

    it('should NOT flush when other windows remain', async () => {
      bm.windows.getAll.mockResolvedValue([{ id: 2 }]);
      const spy = jest.spyOn(window.ShadowLog.Buffer, 'flush');
      bm.windows.onRemoved._fire(1);
      await settle();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('handleStorageChanged (via storage.onChanged)', () => {
    it('should reload rules when rules key changes', async () => {
      const spy = jest.spyOn(window.ShadowLog.RulesEngine, 'loadRules');
      bm.storage.onChanged._fire(
        { shadowlog_rules: { newValue: [], oldValue: [] } },
        'local'
      );
      await settle();
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('should ignore changes in session storage area', async () => {
      const spy = jest.spyOn(window.ShadowLog.RulesEngine, 'loadRules');
      bm.storage.onChanged._fire(
        { shadowlog_rules: { newValue: [] } },
        'session'
      );
      await settle();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('should ignore changes to other keys', async () => {
      const spy = jest.spyOn(window.ShadowLog.RulesEngine, 'loadRules');
      bm.storage.onChanged._fire(
        { other_key: { newValue: 'x' } },
        'local'
      );
      await settle();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('onInstalled handler', () => {
    it('should initialize default storage on install', async () => {
      bm.runtime.onInstalled._fire({ reason: 'install' });
      await settle();
      // Storage should have been initialized (set was called for rules and action_log)
      expect(bm.storage.local.set).toHaveBeenCalled();
    });
  });

  describe('deduplication', () => {
    beforeEach(async () => {
      bm._localStore.shadowlog_rules = [{
        id: 'r1', name: 'Dedup Test', enabled: true,
        match: { urlRegex: ['example\\.com'], excludeRegex: [] },
        actions: { history: 'delete', cookies: 'keep', cache: 'keep', siteData: 'keep' },
        timing: { asap: true, onTabClose: false, onBrowserClose: false, periodicMinutes: null },
        safety: { maxDeletesPerMinute: 60, cooldownSeconds: 0 },
      }];
      await window.ShadowLog.RulesEngine.loadRules();
    });

    it('should skip processing the same URL within DEDUP_WINDOW_MS', async () => {
      bm.history.deleteUrl.mockClear();

      bm.history.onVisited._fire({ url: 'https://example.com/dup' });
      await settle();

      bm.history.onVisited._fire({ url: 'https://example.com/dup' });
      await settle();

      // deleteUrl should only have been called once for this URL
      const calls = bm.history.deleteUrl.mock.calls.filter(c => c[0].url === 'https://example.com/dup');
      expect(calls.length).toBe(1);
    });

    it('should process the same URL again after DEDUP_WINDOW_MS', async () => {
      bm.history.deleteUrl.mockClear();

      bm.history.onVisited._fire({ url: 'https://example.com/dup2' });
      await settle();

      // Advance past dedup window (fake timers advance Date.now)
      jest.advanceTimersByTime(3000);

      bm.history.onVisited._fire({ url: 'https://example.com/dup2' });
      await settle();

      const calls = bm.history.deleteUrl.mock.calls.filter(c => c[0].url === 'https://example.com/dup2');
      expect(calls.length).toBe(2);
    });
  });
});
