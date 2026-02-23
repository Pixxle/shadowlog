'use strict';

const { createBrowserMock, installBrowserMock } = require('../helpers/browser-mock');
const { loadSource, ensurePolyfills } = require('../helpers/module-loader');

describe('ShadowLog.Constants', () => {
  beforeEach(() => {
    ensurePolyfills();
    installBrowserMock(createBrowserMock());
    window.ShadowLog = {};
    loadSource('shared/constants.js');
  });

  it('should attach Constants to window.ShadowLog', () => {
    expect(window.ShadowLog.Constants).toBeDefined();
    expect(typeof window.ShadowLog.Constants).toBe('object');
  });

  it('should not overwrite existing ShadowLog namespace', () => {
    window.ShadowLog.Foo = 'bar';
    loadSource('shared/constants.js');
    expect(window.ShadowLog.Foo).toBe('bar');
  });

  describe('storage keys', () => {
    it('should define STORAGE_KEY_RULES', () => {
      expect(typeof window.ShadowLog.Constants.STORAGE_KEY_RULES).toBe('string');
    });
    it('should define STORAGE_KEY_BUFFER', () => {
      expect(typeof window.ShadowLog.Constants.STORAGE_KEY_BUFFER).toBe('string');
    });
    it('should define STORAGE_KEY_SETTINGS', () => {
      expect(typeof window.ShadowLog.Constants.STORAGE_KEY_SETTINGS).toBe('string');
    });
    it('should define STORAGE_KEY_ACTION_LOG', () => {
      expect(typeof window.ShadowLog.Constants.STORAGE_KEY_ACTION_LOG).toBe('string');
    });
    it('should define SESSION_KEY_TAB_MAP', () => {
      expect(typeof window.ShadowLog.Constants.SESSION_KEY_TAB_MAP).toBe('string');
    });
    it('should define SESSION_KEY_PAUSED', () => {
      expect(typeof window.ShadowLog.Constants.SESSION_KEY_PAUSED).toBe('string');
    });
  });

  describe('buffer limits', () => {
    it('should define BUFFER_MAX_ENTRIES as 5000', () => {
      expect(window.ShadowLog.Constants.BUFFER_MAX_ENTRIES).toBe(5000);
    });
    it('should define BUFFER_MAX_AGE_MS as 7 days', () => {
      expect(window.ShadowLog.Constants.BUFFER_MAX_AGE_MS).toBe(7 * 24 * 60 * 60 * 1000);
    });
    it('should define BUFFER_MAX_ATTEMPTS as 10', () => {
      expect(window.ShadowLog.Constants.BUFFER_MAX_ATTEMPTS).toBe(10);
    });
  });

  describe('safety defaults', () => {
    it('should define DEFAULT_MAX_DELETES_PER_MINUTE as 60', () => {
      expect(window.ShadowLog.Constants.DEFAULT_MAX_DELETES_PER_MINUTE).toBe(60);
    });
    it('should define DEFAULT_COOLDOWN_SECONDS as 0', () => {
      expect(window.ShadowLog.Constants.DEFAULT_COOLDOWN_SECONDS).toBe(0);
    });
  });

  describe('alarm constants', () => {
    it('should define ALARM_PERIODIC_PREFIX as a string', () => {
      expect(typeof window.ShadowLog.Constants.ALARM_PERIODIC_PREFIX).toBe('string');
      expect(window.ShadowLog.Constants.ALARM_PERIODIC_PREFIX).toMatch(/^shadowlog_/);
    });
    it('should define ALARM_BUFFER_FLUSH', () => {
      expect(typeof window.ShadowLog.Constants.ALARM_BUFFER_FLUSH).toBe('string');
    });
    it('should define BUFFER_FLUSH_INTERVAL_MINUTES as 5', () => {
      expect(window.ShadowLog.Constants.BUFFER_FLUSH_INTERVAL_MINUTES).toBe(5);
    });
    it('should define ALARM_MIN_PERIOD_MINUTES as 1', () => {
      expect(window.ShadowLog.Constants.ALARM_MIN_PERIOD_MINUTES).toBe(1);
    });
  });

  describe('other constants', () => {
    it('should define ACTION_LOG_MAX_ENTRIES as 200', () => {
      expect(window.ShadowLog.Constants.ACTION_LOG_MAX_ENTRIES).toBe(200);
    });
    it('should define DEDUP_WINDOW_MS as 2000', () => {
      expect(window.ShadowLog.Constants.DEDUP_WINDOW_MS).toBe(2000);
    });
    it('should define CACHE_CLEAR_MIN_INTERVAL_MS as 60000', () => {
      expect(window.ShadowLog.Constants.CACHE_CLEAR_MIN_INTERVAL_MS).toBe(60000);
    });
  });
});
