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
    it('should return error for an unparseable URL', async () => {
      const result = await DeletionEngine.executeActions('not a url', { history: 'delete' });
      expect(result.error).toBe('Could not parse URL');
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

    it('should report overall failure when siteData deletion fails', async () => {
      bm.browsingData.remove.mockRejectedValueOnce(new Error('fail'));
      const result = await DeletionEngine.executeActions('https://example.com', {
        history: 'keep', cookies: 'delete', cache: 'keep', siteData: 'keep',
      });
      expect(result.success).toBe(false);
    });
  });
});
