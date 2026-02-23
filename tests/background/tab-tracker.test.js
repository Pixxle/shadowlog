'use strict';

const { createBrowserMock, installBrowserMock } = require('../helpers/browser-mock');
const { loadAllBackgroundModules, ensurePolyfills } = require('../helpers/module-loader');

ensurePolyfills();
installBrowserMock(createBrowserMock());
const SL = loadAllBackgroundModules();
const { TabTracker } = SL;

describe('ShadowLog.TabTracker', () => {
  let bm;

  const SESSION_KEY = 'shadowlog_tab_map';

  function getMap() {
    return bm._sessionStore[SESSION_KEY] || {};
  }

  function seedMap(map) {
    bm._sessionStore[SESSION_KEY] = map;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    bm = installBrowserMock(createBrowserMock());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('trackNavigation', () => {
    it('should store url and timestamp for a tab id', async () => {
      jest.setSystemTime(12345);
      await TabTracker.trackNavigation(1, 'https://example.com');
      const map = getMap();
      expect(map[1]).toBeDefined();
      expect(map[1].url).toBe('https://example.com');
      expect(map[1].timestamp).toBe(12345);
    });

    it('should overwrite previous entry for the same tab id', async () => {
      jest.setSystemTime(10000);
      await TabTracker.trackNavigation(1, 'https://first.com');
      jest.setSystemTime(20000);
      await TabTracker.trackNavigation(1, 'https://second.com');
      const map = getMap();
      expect(map[1].url).toBe('https://second.com');
      expect(map[1].timestamp).toBe(20000);
    });

    it('should track multiple tabs independently', async () => {
      await TabTracker.trackNavigation(1, 'https://tab1.com');
      await TabTracker.trackNavigation(2, 'https://tab2.com');
      await TabTracker.trackNavigation(3, 'https://tab3.com');
      const map = getMap();
      expect(Object.keys(map)).toHaveLength(3);
      expect(map[1].url).toBe('https://tab1.com');
      expect(map[2].url).toBe('https://tab2.com');
      expect(map[3].url).toBe('https://tab3.com');
    });

    it('should use session storage via browser.storage.session', async () => {
      await TabTracker.trackNavigation(1, 'https://example.com');
      expect(bm.storage.session.set).toHaveBeenCalled();
    });

    it('should preserve entries for other tabs when updating one', async () => {
      await TabTracker.trackNavigation(1, 'https://one.com');
      await TabTracker.trackNavigation(2, 'https://two.com');
      await TabTracker.trackNavigation(1, 'https://one-updated.com');
      const map = getMap();
      expect(map[2].url).toBe('https://two.com');
      expect(map[1].url).toBe('https://one-updated.com');
    });
  });

  describe('getTabUrl', () => {
    it('should return the url for a tracked tab', async () => {
      seedMap({ 42: { url: 'https://example.com', timestamp: 1000 } });
      const url = await TabTracker.getTabUrl(42);
      expect(url).toBe('https://example.com');
    });

    it('should return null for an untracked tab', async () => {
      const url = await TabTracker.getTabUrl(999);
      expect(url).toBeNull();
    });

    it('should return null for a tab that was removed', async () => {
      await TabTracker.trackNavigation(1, 'https://example.com');
      await TabTracker.removeTab(1);
      const url = await TabTracker.getTabUrl(1);
      expect(url).toBeNull();
    });

    it('should return the latest url after multiple navigations', async () => {
      await TabTracker.trackNavigation(1, 'https://first.com');
      await TabTracker.trackNavigation(1, 'https://second.com');
      const url = await TabTracker.getTabUrl(1);
      expect(url).toBe('https://second.com');
    });
  });

  describe('removeTab', () => {
    it('should remove the entry for the given tab id', async () => {
      await TabTracker.trackNavigation(1, 'https://example.com');
      await TabTracker.removeTab(1);
      const map = getMap();
      expect(map[1]).toBeUndefined();
    });

    it('should not affect other tracked tabs', async () => {
      await TabTracker.trackNavigation(1, 'https://one.com');
      await TabTracker.trackNavigation(2, 'https://two.com');
      await TabTracker.removeTab(1);
      const map = getMap();
      expect(map[2]).toBeDefined();
      expect(map[2].url).toBe('https://two.com');
    });

    it('should be safe to call for a non-existent tab', async () => {
      await expect(TabTracker.removeTab(999)).resolves.not.toThrow();
    });

    it('should use session storage to persist removal', async () => {
      await TabTracker.trackNavigation(1, 'https://example.com');
      bm.storage.session.set.mockClear();
      await TabTracker.removeTab(1);
      expect(bm.storage.session.set).toHaveBeenCalled();
    });
  });

  describe('getAllTracked', () => {
    it('should return empty object when nothing is tracked', async () => {
      const map = await TabTracker.getAllTracked();
      expect(map).toEqual({});
    });

    it('should return all tracked tabs', async () => {
      await TabTracker.trackNavigation(1, 'https://one.com');
      await TabTracker.trackNavigation(2, 'https://two.com');
      const map = await TabTracker.getAllTracked();
      expect(Object.keys(map)).toHaveLength(2);
      expect(map[1].url).toBe('https://one.com');
      expect(map[2].url).toBe('https://two.com');
    });

    it('should reflect removals', async () => {
      await TabTracker.trackNavigation(1, 'https://one.com');
      await TabTracker.trackNavigation(2, 'https://two.com');
      await TabTracker.removeTab(1);
      const map = await TabTracker.getAllTracked();
      expect(Object.keys(map)).toHaveLength(1);
      expect(map[1]).toBeUndefined();
      expect(map[2].url).toBe('https://two.com');
    });

    it('should return entries with url and timestamp', async () => {
      jest.setSystemTime(77777);
      await TabTracker.trackNavigation(5, 'https://stamped.com');
      const map = await TabTracker.getAllTracked();
      expect(map[5]).toEqual({ url: 'https://stamped.com', timestamp: 77777 });
    });

    it('should work with seeded session storage', async () => {
      seedMap({
        10: { url: 'https://seeded.com', timestamp: 5000 },
        20: { url: 'https://other.com', timestamp: 6000 },
      });
      const map = await TabTracker.getAllTracked();
      expect(map[10].url).toBe('https://seeded.com');
      expect(map[20].url).toBe('https://other.com');
    });
  });

  describe('integration scenarios', () => {
    it('should handle rapid navigation in the same tab', async () => {
      jest.setSystemTime(1000);
      await TabTracker.trackNavigation(1, 'https://a.com');
      jest.setSystemTime(1001);
      await TabTracker.trackNavigation(1, 'https://b.com');
      jest.setSystemTime(1002);
      await TabTracker.trackNavigation(1, 'https://c.com');
      const url = await TabTracker.getTabUrl(1);
      expect(url).toBe('https://c.com');
    });

    it('should handle numeric string tab ids', async () => {
      await TabTracker.trackNavigation('42', 'https://string-id.com');
      const url = await TabTracker.getTabUrl('42');
      expect(url).toBe('https://string-id.com');
    });

    it('should handle URLs with special characters', async () => {
      const specialUrl = 'https://example.com/path?q=hello%20world&lang=en#section';
      await TabTracker.trackNavigation(1, specialUrl);
      const url = await TabTracker.getTabUrl(1);
      expect(url).toBe(specialUrl);
    });

    it('should handle about: URLs', async () => {
      await TabTracker.trackNavigation(1, 'about:blank');
      const url = await TabTracker.getTabUrl(1);
      expect(url).toBe('about:blank');
    });

    it('should track and remove many tabs correctly', async () => {
      for (let i = 1; i <= 10; i++) {
        await TabTracker.trackNavigation(i, `https://site-${i}.com`);
      }
      const mapBefore = await TabTracker.getAllTracked();
      expect(Object.keys(mapBefore)).toHaveLength(10);

      for (let i = 1; i <= 5; i++) {
        await TabTracker.removeTab(i);
      }
      const mapAfter = await TabTracker.getAllTracked();
      expect(Object.keys(mapAfter)).toHaveLength(5);
      expect(mapAfter[1]).toBeUndefined();
      expect(mapAfter[6].url).toBe('https://site-6.com');
    });

    it('should read from session storage on getTabUrl', async () => {
      await TabTracker.trackNavigation(1, 'https://example.com');
      bm.storage.session.get.mockClear();
      await TabTracker.getTabUrl(1);
      expect(bm.storage.session.get).toHaveBeenCalled();
    });

    it('should read from session storage on getAllTracked', async () => {
      bm.storage.session.get.mockClear();
      await TabTracker.getAllTracked();
      expect(bm.storage.session.get).toHaveBeenCalled();
    });
  });
});
