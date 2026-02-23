'use strict';

const { createBrowserMock, installBrowserMock } = require('../helpers/browser-mock');
const { loadAllBackgroundModules, ensurePolyfills } = require('../helpers/module-loader');

ensurePolyfills();
installBrowserMock(createBrowserMock());
const SL = loadAllBackgroundModules();
const { Buffer, DeletionEngine } = SL;

describe('ShadowLog.Buffer', () => {
  let bm;

  const STORAGE_KEY = 'shadowlog_buffer';

  function makeEntry(overrides = {}) {
    return {
      url: overrides.url || 'https://example.com/page',
      actions: overrides.actions || { history: 'delete', cookies: 'keep', cache: 'keep', siteData: 'keep' },
      hostname: overrides.hostname || undefined,
      ruleIdMatched: overrides.ruleIdMatched || null,
    };
  }

  function seedBuffer(entries) {
    bm._localStore[STORAGE_KEY] = entries;
  }

  function getBuffer() {
    return bm._localStore[STORAGE_KEY] || [];
  }

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(100000);
    bm = installBrowserMock(createBrowserMock());
    // Ensure buffer starts empty
    await Buffer.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('enqueue', () => {
    it('should add an entry to an empty buffer', async () => {
      await Buffer.enqueue(makeEntry());
      const buf = getBuffer();
      expect(buf).toHaveLength(1);
      expect(buf[0].url).toBe('https://example.com/page');
      expect(buf[0].status).toBe('pending');
      expect(buf[0].attempts).toBe(0);
    });

    it('should assign an id to each entry', async () => {
      await Buffer.enqueue(makeEntry());
      const buf = getBuffer();
      expect(buf[0].id).toBeDefined();
      expect(typeof buf[0].id).toBe('string');
    });

    it('should set firstSeenAt to current time', async () => {
      jest.setSystemTime(55555);
      await Buffer.enqueue(makeEntry());
      const buf = getBuffer();
      expect(buf[0].firstSeenAt).toBe(55555);
    });

    it('should extract hostname using DeletionEngine when not provided', async () => {
      await Buffer.enqueue(makeEntry({ url: 'https://test.example.com/foo' }));
      const buf = getBuffer();
      expect(buf[0].hostname).toBe('test.example.com');
    });

    it('should use provided hostname when given', async () => {
      await Buffer.enqueue(makeEntry({ hostname: 'custom.host' }));
      const buf = getBuffer();
      expect(buf[0].hostname).toBe('custom.host');
    });

    it('should deduplicate by URL when an existing entry is pending', async () => {
      await Buffer.enqueue(makeEntry({ url: 'https://dup.com' }));
      jest.setSystemTime(200000);
      await Buffer.enqueue(makeEntry({ url: 'https://dup.com', actions: { history: 'keep', cookies: 'delete', cache: 'keep', siteData: 'keep' } }));
      const buf = getBuffer();
      expect(buf).toHaveLength(1);
      expect(buf[0].actions.cookies).toBe('delete');
      expect(buf[0].lastAttemptAt).toBe(200000);
    });

    it('should not deduplicate different URLs', async () => {
      await Buffer.enqueue(makeEntry({ url: 'https://one.com' }));
      await Buffer.enqueue(makeEntry({ url: 'https://two.com' }));
      const buf = getBuffer();
      expect(buf).toHaveLength(2);
    });

    it('should not deduplicate when existing entry is not pending', async () => {
      seedBuffer([{
        id: 'old', url: 'https://dup.com', status: 'failed', attempts: 10,
        hostname: 'dup.com', actions: {}, firstSeenAt: 1000, lastAttemptAt: null,
        ruleIdMatched: null,
      }]);
      await Buffer.enqueue(makeEntry({ url: 'https://dup.com' }));
      const buf = getBuffer();
      expect(buf).toHaveLength(2);
    });

    it('should trim oldest entries when exceeding BUFFER_MAX_ENTRIES', async () => {
      const entries = [];
      for (let i = 0; i < 5000; i++) {
        entries.push({
          id: `entry-${i}`,
          url: `https://site-${i}.com`,
          hostname: `site-${i}.com`,
          actions: { history: 'delete', cookies: 'keep', cache: 'keep', siteData: 'keep' },
          ruleIdMatched: null,
          firstSeenAt: i,
          lastAttemptAt: null,
          attempts: 0,
          status: 'pending',
        });
      }
      seedBuffer(entries);

      jest.setSystemTime(999999);
      await Buffer.enqueue(makeEntry({ url: 'https://new-entry.com' }));
      const buf = getBuffer();
      expect(buf).toHaveLength(5000);
      expect(buf.find(e => e.url === 'https://site-0.com')).toBeUndefined();
      expect(buf.find(e => e.url === 'https://new-entry.com')).toBeDefined();
    });

    it('should store ruleIdMatched when provided', async () => {
      await Buffer.enqueue(makeEntry({ ruleIdMatched: 'rule-abc' }));
      const buf = getBuffer();
      expect(buf[0].ruleIdMatched).toBe('rule-abc');
    });
  });

  describe('dequeueReady', () => {
    it('should return empty array when buffer is empty', async () => {
      const ready = await Buffer.dequeueReady();
      expect(ready).toEqual([]);
    });

    it('should return pending entries with no prior attempts', async () => {
      seedBuffer([{
        id: 'e1', url: 'https://a.com', status: 'pending', attempts: 0,
        lastAttemptAt: null, hostname: 'a.com', actions: {},
        firstSeenAt: 1000, ruleIdMatched: null,
      }]);
      const ready = await Buffer.dequeueReady();
      expect(ready).toHaveLength(1);
    });

    it('should exclude entries with 10 or more attempts', async () => {
      seedBuffer([{
        id: 'e1', url: 'https://a.com', status: 'pending', attempts: 10,
        lastAttemptAt: 1000, hostname: 'a.com', actions: {},
        firstSeenAt: 1000, ruleIdMatched: null,
      }]);
      const ready = await Buffer.dequeueReady();
      expect(ready).toHaveLength(0);
    });

    it('should exclude entries attempted less than 5 seconds ago', async () => {
      jest.setSystemTime(10000);
      seedBuffer([{
        id: 'e1', url: 'https://a.com', status: 'pending', attempts: 1,
        lastAttemptAt: 8000,
        hostname: 'a.com', actions: {},
        firstSeenAt: 1000, ruleIdMatched: null,
      }]);
      const ready = await Buffer.dequeueReady();
      expect(ready).toHaveLength(0);
    });

    it('should include entries attempted more than 5 seconds ago', async () => {
      jest.setSystemTime(20000);
      seedBuffer([{
        id: 'e1', url: 'https://a.com', status: 'pending', attempts: 1,
        lastAttemptAt: 14000,
        hostname: 'a.com', actions: {},
        firstSeenAt: 1000, ruleIdMatched: null,
      }]);
      const ready = await Buffer.dequeueReady();
      expect(ready).toHaveLength(1);
    });

    it('should exclude failed entries', async () => {
      seedBuffer([{
        id: 'e1', url: 'https://a.com', status: 'failed', attempts: 10,
        lastAttemptAt: 1000, hostname: 'a.com', actions: {},
        firstSeenAt: 1000, ruleIdMatched: null,
      }]);
      const ready = await Buffer.dequeueReady();
      expect(ready).toHaveLength(0);
    });

    it('should return multiple ready entries', async () => {
      jest.setSystemTime(50000);
      seedBuffer([
        { id: 'e1', url: 'https://a.com', status: 'pending', attempts: 0, lastAttemptAt: null, hostname: 'a.com', actions: {}, firstSeenAt: 1000, ruleIdMatched: null },
        { id: 'e2', url: 'https://b.com', status: 'pending', attempts: 2, lastAttemptAt: 40000, hostname: 'b.com', actions: {}, firstSeenAt: 2000, ruleIdMatched: null },
      ]);
      const ready = await Buffer.dequeueReady();
      expect(ready).toHaveLength(2);
    });
  });

  describe('markSuccess', () => {
    it('should remove the entry from the buffer', async () => {
      seedBuffer([
        { id: 'e1', url: 'https://a.com', status: 'pending', attempts: 0, lastAttemptAt: null, hostname: 'a.com', actions: {}, firstSeenAt: 1000, ruleIdMatched: null },
        { id: 'e2', url: 'https://b.com', status: 'pending', attempts: 0, lastAttemptAt: null, hostname: 'b.com', actions: {}, firstSeenAt: 2000, ruleIdMatched: null },
      ]);
      await Buffer.markSuccess('e1');
      const buf = getBuffer();
      expect(buf).toHaveLength(1);
      expect(buf[0].id).toBe('e2');
    });

    it('should do nothing when entry id is not found', async () => {
      seedBuffer([
        { id: 'e1', url: 'https://a.com', status: 'pending', attempts: 0, lastAttemptAt: null, hostname: 'a.com', actions: {}, firstSeenAt: 1000, ruleIdMatched: null },
      ]);
      await Buffer.markSuccess('nonexistent');
      const buf = getBuffer();
      expect(buf).toHaveLength(1);
    });
  });

  describe('markFailed', () => {
    it('should increment the attempts counter', async () => {
      seedBuffer([
        { id: 'e1', url: 'https://a.com', status: 'pending', attempts: 3, lastAttemptAt: null, hostname: 'a.com', actions: {}, firstSeenAt: 1000, ruleIdMatched: null },
      ]);
      jest.setSystemTime(50000);
      await Buffer.markFailed('e1');
      const buf = getBuffer();
      expect(buf[0].attempts).toBe(4);
      expect(buf[0].lastAttemptAt).toBe(50000);
    });

    it('should set status to failed when attempts reaches 10', async () => {
      seedBuffer([
        { id: 'e1', url: 'https://a.com', status: 'pending', attempts: 9, lastAttemptAt: null, hostname: 'a.com', actions: {}, firstSeenAt: 1000, ruleIdMatched: null },
      ]);
      await Buffer.markFailed('e1');
      const buf = getBuffer();
      expect(buf[0].status).toBe('failed');
      expect(buf[0].attempts).toBe(10);
    });

    it('should keep status as pending when attempts is below 10', async () => {
      seedBuffer([
        { id: 'e1', url: 'https://a.com', status: 'pending', attempts: 5, lastAttemptAt: null, hostname: 'a.com', actions: {}, firstSeenAt: 1000, ruleIdMatched: null },
      ]);
      await Buffer.markFailed('e1');
      const buf = getBuffer();
      expect(buf[0].status).toBe('pending');
    });

    it('should do nothing when entry id is not found', async () => {
      seedBuffer([
        { id: 'e1', url: 'https://a.com', status: 'pending', attempts: 0, lastAttemptAt: null, hostname: 'a.com', actions: {}, firstSeenAt: 1000, ruleIdMatched: null },
      ]);
      await Buffer.markFailed('nonexistent');
      const buf = getBuffer();
      expect(buf[0].attempts).toBe(0);
    });
  });

  describe('trimExpired', () => {
    it('should remove entries older than 7 days', async () => {
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      jest.setSystemTime(sevenDaysMs + 5000);
      seedBuffer([
        { id: 'old', url: 'https://old.com', status: 'pending', attempts: 0, lastAttemptAt: null, hostname: 'old.com', actions: {}, firstSeenAt: 1000, ruleIdMatched: null },
        { id: 'new', url: 'https://new.com', status: 'pending', attempts: 0, lastAttemptAt: null, hostname: 'new.com', actions: {}, firstSeenAt: sevenDaysMs + 4000, ruleIdMatched: null },
      ]);
      await Buffer.trimExpired();
      const buf = getBuffer();
      expect(buf).toHaveLength(1);
      expect(buf[0].id).toBe('new');
    });

    it('should keep entries within the 7 day window', async () => {
      jest.setSystemTime(100000);
      seedBuffer([
        { id: 'e1', url: 'https://a.com', status: 'pending', attempts: 0, lastAttemptAt: null, hostname: 'a.com', actions: {}, firstSeenAt: 50000, ruleIdMatched: null },
      ]);
      await Buffer.trimExpired();
      const buf = getBuffer();
      expect(buf).toHaveLength(1);
    });

    it('should not write to storage if no entries are trimmed', async () => {
      jest.setSystemTime(100000);
      seedBuffer([
        { id: 'e1', url: 'https://a.com', status: 'pending', attempts: 0, lastAttemptAt: null, hostname: 'a.com', actions: {}, firstSeenAt: 99999, ruleIdMatched: null },
      ]);
      bm.storage.local.set.mockClear();
      await Buffer.trimExpired();
      expect(bm.storage.local.set).not.toHaveBeenCalled();
    });
  });

  describe('flush', () => {
    it('should do nothing when no ready entries exist', async () => {
      jest.spyOn(DeletionEngine, 'executeActions');
      await Buffer.flush();
      expect(DeletionEngine.executeActions).not.toHaveBeenCalled();
      DeletionEngine.executeActions.mockRestore();
    });

    it('should call executeActions for each ready entry and remove on success', async () => {
      jest.setSystemTime(50000);
      seedBuffer([
        { id: 'e1', url: 'https://a.com', status: 'pending', attempts: 0, lastAttemptAt: null, hostname: 'a.com', actions: { history: 'delete', cookies: 'keep', cache: 'keep', siteData: 'keep' }, firstSeenAt: 1000, ruleIdMatched: null },
      ]);

      await Buffer.flush();

      const buf = getBuffer();
      expect(buf).toHaveLength(0);
    });

    it('should increment attempts on failed execution', async () => {
      jest.setSystemTime(50000);
      seedBuffer([
        { id: 'e1', url: 'https://a.com', status: 'pending', attempts: 0, lastAttemptAt: null, hostname: 'a.com', actions: { history: 'delete', cookies: 'keep', cache: 'keep', siteData: 'keep' }, firstSeenAt: 1000, ruleIdMatched: null },
      ]);
      bm.history.deleteUrl.mockRejectedValueOnce(new Error('network error'));
      await Buffer.flush();
      const buf = getBuffer();
      expect(buf).toHaveLength(1);
      expect(buf[0].attempts).toBe(1);
    });

    it('should process multiple ready entries', async () => {
      jest.setSystemTime(50000);
      seedBuffer([
        { id: 'e1', url: 'https://a.com', status: 'pending', attempts: 0, lastAttemptAt: null, hostname: 'a.com', actions: { history: 'delete', cookies: 'keep', cache: 'keep', siteData: 'keep' }, firstSeenAt: 1000, ruleIdMatched: null },
        { id: 'e2', url: 'https://b.com', status: 'pending', attempts: 0, lastAttemptAt: null, hostname: 'b.com', actions: { history: 'delete', cookies: 'keep', cache: 'keep', siteData: 'keep' }, firstSeenAt: 2000, ruleIdMatched: null },
      ]);
      await Buffer.flush();
      const buf = getBuffer();
      expect(buf).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('should return zeros for an empty buffer', async () => {
      const stats = await Buffer.getStats();
      expect(stats).toEqual({ total: 0, pending: 0, failed: 0 });
    });

    it('should count pending and failed entries', async () => {
      seedBuffer([
        { id: 'e1', url: 'https://a.com', status: 'pending', attempts: 0, lastAttemptAt: null, hostname: 'a.com', actions: {}, firstSeenAt: 1000, ruleIdMatched: null },
        { id: 'e2', url: 'https://b.com', status: 'failed', attempts: 10, lastAttemptAt: 5000, hostname: 'b.com', actions: {}, firstSeenAt: 2000, ruleIdMatched: null },
        { id: 'e3', url: 'https://c.com', status: 'pending', attempts: 3, lastAttemptAt: 3000, hostname: 'c.com', actions: {}, firstSeenAt: 3000, ruleIdMatched: null },
      ]);
      const stats = await Buffer.getStats();
      expect(stats.total).toBe(3);
      expect(stats.pending).toBe(2);
      expect(stats.failed).toBe(1);
    });
  });

  describe('clear', () => {
    it('should empty the buffer', async () => {
      seedBuffer([
        { id: 'e1', url: 'https://a.com', status: 'pending', attempts: 0, lastAttemptAt: null, hostname: 'a.com', actions: {}, firstSeenAt: 1000, ruleIdMatched: null },
      ]);
      await Buffer.clear();
      const buf = getBuffer();
      expect(buf).toEqual([]);
    });

    it('should result in zero stats after clearing', async () => {
      seedBuffer([
        { id: 'e1', url: 'https://a.com', status: 'pending', attempts: 0, lastAttemptAt: null, hostname: 'a.com', actions: {}, firstSeenAt: 1000, ruleIdMatched: null },
        { id: 'e2', url: 'https://b.com', status: 'failed', attempts: 10, lastAttemptAt: 5000, hostname: 'b.com', actions: {}, firstSeenAt: 2000, ruleIdMatched: null },
      ]);
      await Buffer.clear();
      const stats = await Buffer.getStats();
      expect(stats).toEqual({ total: 0, pending: 0, failed: 0 });
    });
  });
});
