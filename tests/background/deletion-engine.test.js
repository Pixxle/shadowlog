'use strict';

const { createBrowserMock, installBrowserMock } = require('../helpers/browser-mock');
const { loadAllBackgroundModules, ensurePolyfills } = require('../helpers/module-loader');

ensurePolyfills();
installBrowserMock(createBrowserMock());
const SL = loadAllBackgroundModules();
const { DeletionEngine } = SL;

describe('ShadowLog.DeletionEngine', () => {
  let bm;

  beforeEach(() => {
    jest.useFakeTimers();
    bm = installBrowserMock(createBrowserMock());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('extractHostname', () => {
    it('should extract hostname from a valid HTTP URL', () => {
      expect(DeletionEngine.extractHostname('https://example.com/path')).toBe('example.com');
    });

    it('should extract hostname from a URL with port', () => {
      expect(DeletionEngine.extractHostname('https://example.com:8080/path')).toBe('example.com');
    });

    it('should extract hostname from a URL with www prefix', () => {
      expect(DeletionEngine.extractHostname('https://www.example.com')).toBe('www.example.com');
    });

    it('should return null for an invalid URL', () => {
      expect(DeletionEngine.extractHostname('not a url')).toBeNull();
    });

    it('should return null for an empty string', () => {
      expect(DeletionEngine.extractHostname('')).toBeNull();
    });

    it('should extract hostname from a URL with subdomain', () => {
      expect(DeletionEngine.extractHostname('https://sub.domain.example.com/path')).toBe('sub.domain.example.com');
    });
  });

  describe('expandHostnames', () => {
    it('should add www variant for a bare hostname', () => {
      const result = DeletionEngine.expandHostnames('example.com');
      expect(result).toContain('example.com');
      expect(result).toContain('www.example.com');
      expect(result).toHaveLength(2);
    });

    it('should add non-www variant when hostname starts with www', () => {
      const result = DeletionEngine.expandHostnames('www.example.com');
      expect(result).toContain('www.example.com');
      expect(result).toContain('example.com');
      expect(result).toHaveLength(2);
    });

    it('should handle subdomains correctly', () => {
      const result = DeletionEngine.expandHostnames('sub.example.com');
      expect(result).toContain('sub.example.com');
      expect(result).toContain('www.sub.example.com');
    });
  });

  describe('deleteHistory', () => {
    it('should call browser.history.deleteUrl with the URL', async () => {
      const result = await DeletionEngine.deleteHistory('https://example.com');
      expect(bm.history.deleteUrl).toHaveBeenCalledWith({ url: 'https://example.com' });
      expect(result.success).toBe(true);
    });

    it('should delete equivalent redirect variants found in history search', async () => {
      bm.history.search.mockResolvedValueOnce([
        { url: 'https://www.example.com/' },
        { url: 'http://example.com/' },
        { url: 'https://www.example.com/somewhere-else' },
      ]);

      const result = await DeletionEngine.deleteHistory('http://example.com/');
      const deletedUrls = bm.history.deleteUrl.mock.calls.map((call) => call[0].url);

      expect(bm.history.search).toHaveBeenCalledWith({
        text: 'example.com',
        startTime: 0,
        maxResults: 1000,
      });
      expect(deletedUrls).toEqual(expect.arrayContaining([
        'http://example.com/',
        'https://www.example.com/',
      ]));
      expect(deletedUrls).not.toContain('https://www.example.com/somewhere-else');
      expect(result.success).toBe(true);
    });

    it('should treat trailing slash variants as equivalent', async () => {
      bm.history.search.mockResolvedValueOnce([
        { url: 'https://www.example.com/path/' },
      ]);

      await DeletionEngine.deleteHistory('http://example.com/path');

      const deletedUrls = bm.history.deleteUrl.mock.calls.map((call) => call[0].url);
      expect(deletedUrls).toEqual(expect.arrayContaining([
        'http://example.com/path',
        'https://www.example.com/path/',
      ]));
    });

    it('should delete current page and descendant pages when includeSubpages is true', async () => {
      bm.history.search.mockResolvedValueOnce([
        { url: 'https://example.com/area' },
        { url: 'https://example.com/area/sub' },
        { url: 'https://www.example.com/area/sub/deeper?x=1' },
        { url: 'https://example.com/area-else' },
        { url: 'https://example.com/other' },
      ]);

      await DeletionEngine.deleteHistory('https://example.com/area', { includeSubpages: true });

      const deletedUrls = bm.history.deleteUrl.mock.calls.map((call) => call[0].url);
      expect(deletedUrls).toEqual(expect.arrayContaining([
        'https://example.com/area',
        'https://example.com/area/sub',
        'https://www.example.com/area/sub/deeper?x=1',
      ]));
      expect(deletedUrls).not.toContain('https://example.com/area-else');
      expect(deletedUrls).not.toContain('https://example.com/other');
    });

    it('should return success false with error on failure', async () => {
      bm.history.deleteUrl.mockRejectedValueOnce(new Error('not found'));
      const result = await DeletionEngine.deleteHistory('https://example.com');
      expect(result.success).toBe(false);
      expect(result.error).toBe('not found');
    });
  });

  describe('deleteSiteData', () => {
    it('should call browsingData.remove with cookies datatype', async () => {
      const result = await DeletionEngine.deleteSiteData('example.com', { cookies: 'delete', siteData: 'keep' });
      expect(bm.browsingData.remove).toHaveBeenCalledWith(
        { hostnames: expect.arrayContaining(['example.com', 'www.example.com']) },
        { cookies: true }
      );
      expect(result.success).toBe(true);
    });

    it('should call browsingData.remove with siteData datatypes', async () => {
      const result = await DeletionEngine.deleteSiteData('example.com', { cookies: 'keep', siteData: 'delete' });
      expect(bm.browsingData.remove).toHaveBeenCalledWith(
        { hostnames: expect.arrayContaining(['example.com', 'www.example.com']) },
        { localStorage: true, indexedDB: true, serviceWorkers: true }
      );
      expect(result.success).toBe(true);
    });

    it('should combine cookies and siteData datatypes', async () => {
      const result = await DeletionEngine.deleteSiteData('example.com', { cookies: 'delete', siteData: 'delete' });
      expect(bm.browsingData.remove).toHaveBeenCalledWith(
        { hostnames: expect.arrayContaining(['example.com', 'www.example.com']) },
        { cookies: true, localStorage: true, indexedDB: true, serviceWorkers: true }
      );
      expect(result.success).toBe(true);
    });

    it('should return skipped:true when nothing to clear', async () => {
      const result = await DeletionEngine.deleteSiteData('example.com', { cookies: 'keep', siteData: 'keep' });
      expect(bm.browsingData.remove).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
    });

    it('should return success false with error on failure', async () => {
      bm.browsingData.remove.mockRejectedValueOnce(new Error('permission denied'));
      const result = await DeletionEngine.deleteSiteData('example.com', { cookies: 'delete', siteData: 'keep' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('permission denied');
    });

    it('should expand www hostname to include non-www variant', async () => {
      await DeletionEngine.deleteSiteData('www.example.com', { cookies: 'delete', siteData: 'keep' });
      const call = bm.browsingData.remove.mock.calls[0];
      expect(call[0].hostnames).toContain('www.example.com');
      expect(call[0].hostnames).toContain('example.com');
    });

    it('should return hostnames and dataTypes in result on success', async () => {
      const result = await DeletionEngine.deleteSiteData('example.com', { cookies: 'delete', siteData: 'keep' });
      expect(result.hostnames).toEqual(expect.arrayContaining(['example.com', 'www.example.com']));
      expect(result.dataTypes).toContain('cookies');
    });
  });

  describe('clearGlobalCache', () => {
    // The internal lastCacheClearTime persists across tests because the module
    // is loaded once. Each test uses a monotonically-increasing base timestamp
    // well beyond 60s from any prior test to avoid rate-limit carryover.
    // Each test uses a unique high base timestamp to avoid rate-limit
    // interference from prior clearGlobalCache calls (since lastCacheClearTime
    // is a persistent closure variable). The value is high enough to always be
    // past any prior timestamp + the 60s rate window.
    let cacheTestBase = 1_000_000;

    beforeEach(() => {
      // Advance the base far enough for each test to have a clean window.
      cacheTestBase += 200_000;
    });

    it('should call browsingData.remove with cache:true on first call', async () => {
      jest.setSystemTime(cacheTestBase);
      const result = await DeletionEngine.clearGlobalCache();
      expect(bm.browsingData.remove).toHaveBeenCalledWith({}, { cache: true });
      expect(result.success).toBe(true);
    });

    it('should rate-limit to once per 60 seconds', async () => {
      jest.setSystemTime(cacheTestBase);
      await DeletionEngine.clearGlobalCache();
      expect(bm.browsingData.remove).toHaveBeenCalledTimes(1);

      // 30s later -- should be rate limited
      jest.setSystemTime(cacheTestBase + 30000);
      const result2 = await DeletionEngine.clearGlobalCache();
      expect(bm.browsingData.remove).toHaveBeenCalledTimes(1);
      expect(result2.success).toBe(true);
      expect(result2.skipped).toBe(true);
      expect(result2.reason).toBe('rate-limited');
    });

    it('should allow a second call after 60 seconds', async () => {
      jest.setSystemTime(cacheTestBase);
      await DeletionEngine.clearGlobalCache();

      jest.setSystemTime(cacheTestBase + 60001);
      const result2 = await DeletionEngine.clearGlobalCache();
      expect(bm.browsingData.remove).toHaveBeenCalledTimes(2);
      expect(result2.success).toBe(true);
      expect(result2.skipped).toBeUndefined();
    });

    it('should return error on failure without updating the rate limit time', async () => {
      jest.setSystemTime(cacheTestBase);
      bm.browsingData.remove.mockRejectedValueOnce(new Error('cache error'));
      const result = await DeletionEngine.clearGlobalCache();
      expect(result.success).toBe(false);
      expect(result.error).toBe('cache error');

      // Retry immediately -- should succeed because lastCacheClearTime was NOT updated
      jest.setSystemTime(cacheTestBase + 1);
      bm.browsingData.remove.mockResolvedValueOnce();
      const result2 = await DeletionEngine.clearGlobalCache();
      expect(result2.success).toBe(true);
    });
  });

  describe('executeActions', () => {
    it('should report history failure for an unparseable URL when deleting history', async () => {
      bm.history.deleteUrl.mockRejectedValueOnce(new Error('Invalid URL'));
      const result = await DeletionEngine.executeActions('not a url', { history: 'delete' });
      expect(result.success).toBe(false);
      expect(result.history.success).toBe(false);
    });

    it('should still clear cache for an unparseable URL when cache is requested', async () => {
      jest.setSystemTime(4_000_000);
      const result = await DeletionEngine.executeActions('not a url', {
        history: 'keep', cookies: 'keep', cache: 'delete', siteData: 'keep',
      });
      expect(bm.browsingData.remove).toHaveBeenCalledWith({}, { cache: true });
      expect(result.cache.success).toBe(true);
      expect(result.success).toBe(true);
    });

    it('should report siteData parse error only when siteData deletion is requested', async () => {
      const result = await DeletionEngine.executeActions('not a url', {
        history: 'keep', cookies: 'delete', cache: 'keep', siteData: 'keep',
      });
      expect(result.success).toBe(false);
      expect(result.siteData).toEqual({ success: false, error: 'Could not parse URL' });
    });

    it('should delete history when action is delete', async () => {
      const result = await DeletionEngine.executeActions('https://example.com/page', {
        history: 'delete', cookies: 'keep', cache: 'keep', siteData: 'keep',
      });
      expect(bm.history.deleteUrl).toHaveBeenCalledWith({ url: 'https://example.com/page' });
      expect(result.history.success).toBe(true);
      expect(result.success).toBe(true);
    });

    it('should not delete history when action is keep', async () => {
      const result = await DeletionEngine.executeActions('https://example.com', {
        history: 'keep', cookies: 'keep', cache: 'keep', siteData: 'keep',
      });
      expect(bm.history.deleteUrl).not.toHaveBeenCalled();
      expect(result.history).toBeNull();
      expect(result.success).toBe(true);
    });

    it('should delete site data when cookies or siteData are delete', async () => {
      const result = await DeletionEngine.executeActions('https://example.com', {
        history: 'keep', cookies: 'delete', cache: 'keep', siteData: 'keep',
      });
      expect(bm.browsingData.remove).toHaveBeenCalled();
      expect(result.siteData.success).toBe(true);
    });

    it('should clear cache when cache action is delete', async () => {
      // Use a timestamp far enough past any clearGlobalCache rate limit
      jest.setSystemTime(5_000_000);
      const result = await DeletionEngine.executeActions('https://example.com', {
        history: 'keep', cookies: 'keep', cache: 'delete', siteData: 'keep',
      });
      expect(bm.browsingData.remove).toHaveBeenCalledWith({}, { cache: true });
      expect(result.cache.success).toBe(true);
    });

    it('should orchestrate all deletions together', async () => {
      jest.setSystemTime(5_100_000);
      const result = await DeletionEngine.executeActions('https://example.com/page', {
        history: 'delete', cookies: 'delete', cache: 'delete', siteData: 'delete',
      });
      expect(result.history.success).toBe(true);
      expect(result.siteData.success).toBe(true);
      expect(result.cache.success).toBe(true);
      expect(result.success).toBe(true);
    });

    it('should include url and timestamp in result', async () => {
      jest.setSystemTime(5_200_000);
      const result = await DeletionEngine.executeActions('https://example.com', {
        history: 'keep', cookies: 'keep', cache: 'keep', siteData: 'keep',
      });
      expect(result.url).toBe('https://example.com');
      expect(result.timestamp).toBe(5_200_000);
    });

    it('should report overall failure when history deletion fails', async () => {
      bm.history.deleteUrl.mockRejectedValueOnce(new Error('fail'));
      const result = await DeletionEngine.executeActions('https://example.com', {
        history: 'delete', cookies: 'keep', cache: 'keep', siteData: 'keep',
      });
      expect(result.success).toBe(false);
      expect(result.history.success).toBe(false);
    });

    it('should report overall failure when history deletion is only partially successful', async () => {
      bm.history.search.mockResolvedValueOnce([
        { url: 'https://www.example.com/page' },
      ]);
      bm.history.deleteUrl
        .mockResolvedValueOnce()
        .mockRejectedValueOnce(new Error('second delete failed'));

      const result = await DeletionEngine.executeActions('https://example.com/page', {
        history: 'delete', cookies: 'keep', cache: 'keep', siteData: 'keep',
      });

      expect(result.history.success).toBe(true);
      expect(result.history.partial).toBe(true);
      expect(result.success).toBe(false);
    });

    it('should report overall failure when siteData deletion fails', async () => {
      bm.browsingData.remove.mockRejectedValueOnce(new Error('fail'));
      const result = await DeletionEngine.executeActions('https://example.com', {
        history: 'keep', cookies: 'delete', cache: 'keep', siteData: 'keep',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('areEquivalentHistoryUrls', () => {
    it('should match http/https and www/non-www variants of the same page', () => {
      expect(
        DeletionEngine.areEquivalentHistoryUrls(
          'http://example.com/path?x=1',
          'https://www.example.com/path/?x=1'
        )
      ).toBe(true);
    });

    it('should not match different paths', () => {
      expect(
        DeletionEngine.areEquivalentHistoryUrls(
          'http://example.com/path',
          'https://www.example.com/other'
        )
      ).toBe(false);
    });
  });

  describe('isHistoryUrlInSubtree', () => {
    it('should match the same page and descendants across http/https and www', () => {
      expect(
        DeletionEngine.isHistoryUrlInSubtree(
          'http://example.com/path',
          'https://www.example.com/path/child?x=1'
        )
      ).toBe(true);
      expect(
        DeletionEngine.isHistoryUrlInSubtree(
          'http://example.com/path',
          'https://www.example.com/path'
        )
      ).toBe(true);
    });

    it('should not match sibling paths with the same prefix', () => {
      expect(
        DeletionEngine.isHistoryUrlInSubtree(
          'https://example.com/path',
          'https://example.com/pathology'
        )
      ).toBe(false);
    });
  });
});
