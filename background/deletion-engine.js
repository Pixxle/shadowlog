'use strict';

window.ShadowLog = window.ShadowLog || {};

window.ShadowLog.DeletionEngine = (() => {
  const { Constants } = window.ShadowLog;

  let lastCacheClearTime = 0;

  function expandHostnames(hostname) {
    const hostnames = [hostname];
    if (hostname.startsWith('www.')) {
      hostnames.push(hostname.slice(4));
    } else {
      hostnames.push('www.' + hostname);
    }
    return hostnames;
  }

  function extractHostname(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  }

  async function deleteHistory(url) {
    try {
      await browser.history.deleteUrl({ url });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function deleteSiteData(hostname, dataTypes) {
    // dataTypes: { cookies, siteData }
    // Map to browsingData.remove compatible DataTypeSet
    const dataTypeSet = {};

    if (dataTypes.cookies === 'delete') {
      dataTypeSet.cookies = true;
    }
    if (dataTypes.siteData === 'delete') {
      dataTypeSet.localStorage = true;
      dataTypeSet.indexedDB = true;
      dataTypeSet.serviceWorkers = true;
    }

    // Nothing to clear
    if (Object.keys(dataTypeSet).length === 0) {
      return { success: true, skipped: true };
    }

    const hostnames = expandHostnames(hostname);

    try {
      await browser.browsingData.remove({ hostnames }, dataTypeSet);
      return { success: true, hostnames, dataTypes: Object.keys(dataTypeSet) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function clearGlobalCache() {
    const now = Date.now();
    if (now - lastCacheClearTime < Constants.CACHE_CLEAR_MIN_INTERVAL_MS) {
      return { success: true, skipped: true, reason: 'rate-limited' };
    }

    try {
      await browser.browsingData.remove({}, { cache: true });
      lastCacheClearTime = now;
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function executeActions(url, mergedActions) {
    const results = {
      url,
      timestamp: Date.now(),
      history: null,
      siteData: null,
      cache: null,
    };

    const hostname = extractHostname(url);
    if (!hostname) {
      return { ...results, error: 'Could not parse URL' };
    }

    // Delete history
    if (mergedActions.history === 'delete') {
      results.history = await deleteHistory(url);
    }

    // Delete site data (cookies, localStorage, indexedDB, serviceWorkers)
    if (mergedActions.cookies === 'delete' || mergedActions.siteData === 'delete') {
      results.siteData = await deleteSiteData(hostname, mergedActions);
    }

    // Clear cache (global only — Firefox limitation)
    if (mergedActions.cache === 'delete') {
      results.cache = await clearGlobalCache();
    }

    results.success = (!results.history || results.history.success) &&
      (!results.siteData || results.siteData.success) &&
      (!results.cache || results.cache.success);

    return results;
  }

  return { deleteHistory, deleteSiteData, clearGlobalCache, executeActions, extractHostname, expandHostnames };
})();
