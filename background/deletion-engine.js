'use strict';

window.ShadowLog = window.ShadowLog || {};

window.ShadowLog.DeletionEngine = (() => {
  const { Constants } = window.ShadowLog;

  let lastCacheClearTime = 0;

  function parseUrl(url) {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  }

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
    const parsed = parseUrl(url);
    return parsed ? parsed.hostname : null;
  }

  function normalizePathname(pathname) {
    if (!pathname || pathname === '/') return '/';
    return pathname.replace(/\/+$/, '') || '/';
  }

  function isHttpLikeProtocol(protocol) {
    return protocol === 'http:' || protocol === 'https:';
  }

  function hasCompatibleHistoryOrigin(source, candidate) {
    const allowedHostnames = new Set(expandHostnames(source.hostname));
    if (!allowedHostnames.has(candidate.hostname)) {
      return false;
    }

    if (isHttpLikeProtocol(source.protocol)) {
      return isHttpLikeProtocol(candidate.protocol);
    }

    return candidate.protocol === source.protocol;
  }

  function isSameOrDescendantPath(basePathname, candidatePathname) {
    const base = normalizePathname(basePathname);
    const candidate = normalizePathname(candidatePathname);

    if (base === '/') return true;
    if (candidate === base) return true;

    return candidate.startsWith(base + '/');
  }

  function areEquivalentHistoryUrlObjects(source, candidate) {
    if (!hasCompatibleHistoryOrigin(source, candidate)) {
      return false;
    }

    if (normalizePathname(candidate.pathname) !== normalizePathname(source.pathname)) {
      return false;
    }

    return (candidate.search || '') === (source.search || '');
  }

  function areEquivalentHistoryUrls(sourceUrl, candidateUrl) {
    const source = parseUrl(sourceUrl);
    const candidate = parseUrl(candidateUrl);
    if (!source || !candidate) {
      return false;
    }

    return areEquivalentHistoryUrlObjects(source, candidate);
  }

  function isHistoryUrlInSubtreeObjects(source, candidate) {
    if (!hasCompatibleHistoryOrigin(source, candidate)) {
      return false;
    }

    return isSameOrDescendantPath(source.pathname, candidate.pathname);
  }

  function isHistoryUrlInSubtree(sourceUrl, candidateUrl) {
    const source = parseUrl(sourceUrl);
    const candidate = parseUrl(candidateUrl);
    if (!source || !candidate) {
      return false;
    }

    return isHistoryUrlInSubtreeObjects(source, candidate);
  }

  function createHistoryUrlMatcher(source, includeSubpages) {
    if (includeSubpages) {
      return (candidate) => isHistoryUrlInSubtreeObjects(source, candidate);
    }
    return (candidate) => areEquivalentHistoryUrlObjects(source, candidate);
  }

  async function findMatchingHistoryUrls(url, options = {}) {
    const source = parseUrl(url);
    if (!source || !browser?.history?.search) {
      return [];
    }

    const matcher = createHistoryUrlMatcher(source, !!options.includeSubpages);

    try {
      const items = await browser.history.search({
        text: source.hostname,
        startTime: 0,
        maxResults: 1000,
      });

      return (items || [])
        .map((item) => item && item.url)
        .filter((candidateUrl) => {
          if (!candidateUrl) return false;
          const candidate = parseUrl(candidateUrl);
          return candidate ? matcher(candidate) : false;
        });
    } catch (err) {
      console.warn('ShadowLog: history.search failed, falling back to exact delete', err);
      return [];
    }
  }

  async function deleteHistory(url, options = {}) {
    const includeSubpages = !!options.includeSubpages;
    const logContext = options.logContext || 'history';
    const urlsToDelete = new Set([url]);
    const matchedUrls = await findMatchingHistoryUrls(url, { includeSubpages });
    for (const matchUrl of matchedUrls) {
      urlsToDelete.add(matchUrl);
    }

    const deletedUrls = [];
    const errors = [];

    for (const candidateUrl of urlsToDelete) {
      try {
        await browser.history.deleteUrl({ url: candidateUrl });
        deletedUrls.push(candidateUrl);
        console.log(`ShadowLog [${logContext}]: deleted history entry ${candidateUrl}`);
      } catch (err) {
        errors.push({ url: candidateUrl, error: err.message });
      }
    }

    if (deletedUrls.length === 0 && errors.length > 0) {
      return { success: false, error: errors[0].error, errors, includeSubpages };
    }

    if (errors.length > 0) {
      return { success: true, partial: true, deletedUrls, errors, includeSubpages };
    }

    return { success: true, deletedUrls, includeSubpages };
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

  function isOperationSuccessful(result) {
    if (!result) return true;
    return result.success === true && result.partial !== true;
  }

  async function executeActions(url, mergedActions, options = {}) {
    const results = {
      url,
      timestamp: Date.now(),
      history: null,
      siteData: null,
      cache: null,
    };

    // Delete history
    if (mergedActions.history === 'delete') {
      results.history = await deleteHistory(url, {
        includeSubpages: !!options.historyIncludeSubpages,
        logContext: options.historyLogContext,
      });
    }

    // Delete site data (cookies, localStorage, indexedDB, serviceWorkers)
    if (mergedActions.cookies === 'delete' || mergedActions.siteData === 'delete') {
      const hostname = extractHostname(url);
      if (!hostname) {
        results.siteData = { success: false, error: 'Could not parse URL' };
      } else {
        results.siteData = await deleteSiteData(hostname, mergedActions);
      }
    }

    // Clear cache (global only — Firefox limitation)
    if (mergedActions.cache === 'delete') {
      results.cache = await clearGlobalCache();
    }

    results.success = isOperationSuccessful(results.history) &&
      isOperationSuccessful(results.siteData) &&
      isOperationSuccessful(results.cache);

    return results;
  }

  return {
    deleteHistory,
    deleteSiteData,
    clearGlobalCache,
    executeActions,
    extractHostname,
    expandHostnames,
    areEquivalentHistoryUrls,
    isHistoryUrlInSubtree,
  };
})();
