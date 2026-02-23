'use strict';

const { createBrowserMock, createBrowserMockNoSession, installBrowserMock } = require('../helpers/browser-mock');
const { loadSource, ensurePolyfills, clearAllModules } = require('../helpers/module-loader');

describe('ShadowLog.Storage', () => {
  afterEach(() => {
    clearAllModules();
  });

  describe('with browser.storage.session available', () => {
    let Storage, bm;

    beforeEach(() => {
      ensurePolyfills();
      bm = installBrowserMock(createBrowserMock());
      window.ShadowLog = {};
      loadSource('shared/constants.js');
      loadSource('shared/storage-helpers.js');
      Storage = window.ShadowLog.Storage;
    });

    describe('getLocal', () => {
      it('should return the stored value for a given key', async () => {
        bm._localStore.mykey = 'hello';
        const val = await Storage.getLocal('mykey');
        expect(val).toBe('hello');
      });

      it('should return the defaultValue when key is not in storage', async () => {
        const val = await Storage.getLocal('missing', 'fallback');
        expect(val).toBe('fallback');
      });

      it('should return null as default when no defaultValue provided', async () => {
        const val = await Storage.getLocal('missing');
        expect(val).toBeNull();
      });
    });

    describe('setLocal', () => {
      it('should store a value under the given key', async () => {
        await Storage.setLocal('mykey', 'world');
        expect(bm._localStore.mykey).toBe('world');
      });

      it('should overwrite an existing value', async () => {
        bm._localStore.mykey = 'old';
        await Storage.setLocal('mykey', 'new');
        expect(bm._localStore.mykey).toBe('new');
      });
    });

    describe('removeLocal', () => {
      it('should remove the key from local storage', async () => {
        bm._localStore.mykey = 'val';
        await Storage.removeLocal('mykey');
        expect(bm._localStore.mykey).toBeUndefined();
      });
    });

    describe('getSession', () => {
      it('should return the stored value from session storage', async () => {
        bm._sessionStore.skey = 'sval';
        const val = await Storage.getSession('skey');
        expect(val).toBe('sval');
      });

      it('should return the defaultValue when key is not in session storage', async () => {
        const val = await Storage.getSession('missing', 'default');
        expect(val).toBe('default');
      });

      it('should call browser.storage.session.get', async () => {
        await Storage.getSession('skey');
        expect(bm.storage.session.get).toHaveBeenCalled();
      });
    });

    describe('setSession', () => {
      it('should store a value in session storage', async () => {
        await Storage.setSession('skey', 'sval');
        expect(bm._sessionStore.skey).toBe('sval');
      });

      it('should call browser.storage.session.set', async () => {
        await Storage.setSession('skey', 'sval');
        expect(bm.storage.session.set).toHaveBeenCalled();
      });
    });

    describe('removeSession', () => {
      it('should remove the key from session storage', async () => {
        bm._sessionStore.skey = 'val';
        await Storage.removeSession('skey');
        expect(bm._sessionStore.skey).toBeUndefined();
      });
    });

    describe('updateLocal', () => {
      it('should read current value, apply updater, and write back', async () => {
        bm._localStore.arr = [1, 2];
        const result = await Storage.updateLocal('arr', (arr) => {
          arr.push(3);
          return arr;
        });
        expect(result).toEqual([1, 2, 3]);
        expect(bm._localStore.arr).toEqual([1, 2, 3]);
      });

      it('should use defaultValue when key does not exist', async () => {
        const result = await Storage.updateLocal('missing', (arr) => {
          arr.push(1);
          return arr;
        }, []);
        expect(result).toEqual([1]);
      });

      it('should return the updated value', async () => {
        const result = await Storage.updateLocal('x', () => 42, 0);
        expect(result).toBe(42);
      });
    });
  });

  describe('with browser.storage.session unavailable (fallback)', () => {
    let Storage;

    beforeEach(() => {
      ensurePolyfills();
      installBrowserMock(createBrowserMockNoSession());
      window.ShadowLog = {};
      loadSource('shared/constants.js');
      loadSource('shared/storage-helpers.js');
      Storage = window.ShadowLog.Storage;
    });

    it('should use in-memory fallback for setSession and getSession', async () => {
      await Storage.setSession('key', 'value');
      const val = await Storage.getSession('key');
      expect(val).toBe('value');
    });

    it('should return defaultValue from fallback when key is absent', async () => {
      const val = await Storage.getSession('nonexistent', 'def');
      expect(val).toBe('def');
    });

    it('should handle removeSession via fallback', async () => {
      await Storage.setSession('key', 'value');
      await Storage.removeSession('key');
      const val = await Storage.getSession('key', null);
      expect(val).toBeNull();
    });
  });
});
