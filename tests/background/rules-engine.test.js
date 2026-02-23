'use strict';

const { createBrowserMock, installBrowserMock } = require('../helpers/browser-mock');
const { loadAllBackgroundModules, ensurePolyfills } = require('../helpers/module-loader');

// Load modules once at the top level; they capture references to
// window.ShadowLog.Storage etc. at load time, but Storage methods look up
// globalThis.browser dynamically, so swapping the browser mock between
// tests is sufficient for isolation.
ensurePolyfills();
installBrowserMock(createBrowserMock());
const SL = loadAllBackgroundModules();
const { RulesEngine } = SL;

describe('ShadowLog.RulesEngine', () => {
  let bm;

  function makeRule(overrides = {}) {
    return {
      id: overrides.id || crypto.randomUUID(),
      name: overrides.name || 'Test Rule',
      enabled: overrides.enabled !== undefined ? overrides.enabled : true,
      match: {
        urlRegex: overrides.urlRegex || ['example\\.com'],
        excludeRegex: overrides.excludeRegex || [],
      },
      actions: {
        history: 'delete',
        cookies: 'keep',
        cache: 'keep',
        siteData: 'keep',
        ...(overrides.actions || {}),
      },
      timing: {
        asap: true,
        onTabClose: false,
        onBrowserClose: false,
        periodicMinutes: null,
        ...(overrides.timing || {}),
      },
      safety: {
        maxDeletesPerMinute: 60,
        cooldownSeconds: 0,
        ...(overrides.safety || {}),
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  beforeEach(async () => {
    bm = installBrowserMock(createBrowserMock());
    // Reset compiled rules by loading from empty storage
    await RulesEngine.loadRules();
  });

  describe('loadRules', () => {
    it('should return an empty array when no rules are stored', async () => {
      const result = await RulesEngine.loadRules();
      expect(result).toEqual([]);
    });

    it('should load enabled rules from storage', async () => {
      const rule = makeRule({ name: 'My Rule' });
      bm._localStore.shadowlog_rules = [rule];
      const compiled = await RulesEngine.loadRules();
      expect(compiled).toHaveLength(1);
      expect(compiled[0].name).toBe('My Rule');
    });

    it('should skip disabled rules', async () => {
      const r1 = makeRule({ name: 'Active', enabled: true });
      const r2 = makeRule({ name: 'Inactive', enabled: false });
      bm._localStore.shadowlog_rules = [r1, r2];
      const compiled = await RulesEngine.loadRules();
      expect(compiled).toHaveLength(1);
      expect(compiled[0].name).toBe('Active');
    });

    it('should compile urlRegex patterns into RegExp objects', async () => {
      const rule = makeRule({ urlRegex: ['facebook\\.com', 'twitter\\.com'] });
      bm._localStore.shadowlog_rules = [rule];
      const compiled = await RulesEngine.loadRules();
      expect(compiled[0].urlRegexCompiled).toHaveLength(2);
      expect(compiled[0].urlRegexCompiled[0]).toBeInstanceOf(RegExp);
      expect(compiled[0].urlRegexCompiled[1]).toBeInstanceOf(RegExp);
    });

    it('should skip a rule entirely if any urlRegex is invalid', async () => {
      const rule = makeRule({ urlRegex: ['valid\\.com', '[invalid'] });
      bm._localStore.shadowlog_rules = [rule];
      const compiled = await RulesEngine.loadRules();
      expect(compiled).toHaveLength(0);
    });

    it('should silently skip invalid exclude regex patterns', async () => {
      const rule = makeRule({
        urlRegex: ['example\\.com'],
        excludeRegex: ['good\\.com', '[bad'],
      });
      bm._localStore.shadowlog_rules = [rule];
      const compiled = await RulesEngine.loadRules();
      expect(compiled).toHaveLength(1);
      expect(compiled[0].excludeRegexCompiled).toHaveLength(1);
    });

    it('should compile valid exclude regex patterns', async () => {
      const rule = makeRule({
        urlRegex: ['example\\.com'],
        excludeRegex: ['example\\.com/keep'],
      });
      bm._localStore.shadowlog_rules = [rule];
      const compiled = await RulesEngine.loadRules();
      expect(compiled[0].excludeRegexCompiled).toHaveLength(1);
      expect(compiled[0].excludeRegexCompiled[0]).toBeInstanceOf(RegExp);
    });

    it('should handle rules with no excludeRegex field', async () => {
      const rule = makeRule({ urlRegex: ['test\\.com'] });
      delete rule.match.excludeRegex;
      bm._localStore.shadowlog_rules = [rule];
      const compiled = await RulesEngine.loadRules();
      expect(compiled).toHaveLength(1);
      expect(compiled[0].excludeRegexCompiled).toEqual([]);
    });

    it('should clear previously compiled rules on reload', async () => {
      bm._localStore.shadowlog_rules = [makeRule({ name: 'First' })];
      await RulesEngine.loadRules();
      expect(RulesEngine.getCompiledRules()).toHaveLength(1);

      bm._localStore.shadowlog_rules = [];
      await RulesEngine.loadRules();
      expect(RulesEngine.getCompiledRules()).toHaveLength(0);
    });

    it('should load multiple enabled rules', async () => {
      bm._localStore.shadowlog_rules = [
        makeRule({ name: 'A', urlRegex: ['a\\.com'] }),
        makeRule({ name: 'B', urlRegex: ['b\\.com'] }),
        makeRule({ name: 'C', urlRegex: ['c\\.com'] }),
      ];
      const compiled = await RulesEngine.loadRules();
      expect(compiled).toHaveLength(3);
    });

    it('should preserve rule id, actions, timing, and safety in compiled output', async () => {
      const rule = makeRule({
        id: 'rule-123',
        actions: { history: 'delete', cookies: 'delete', cache: 'keep', siteData: 'keep' },
        timing: { asap: false, onTabClose: true, onBrowserClose: false, periodicMinutes: 15 },
        safety: { maxDeletesPerMinute: 30, cooldownSeconds: 5 },
      });
      bm._localStore.shadowlog_rules = [rule];
      const compiled = await RulesEngine.loadRules();
      expect(compiled[0].id).toBe('rule-123');
      expect(compiled[0].actions.cookies).toBe('delete');
      expect(compiled[0].timing.onTabClose).toBe(true);
      expect(compiled[0].timing.periodicMinutes).toBe(15);
      expect(compiled[0].safety.maxDeletesPerMinute).toBe(30);
    });
  });

  describe('evaluateUrl', () => {
    it('should return an empty array for a URL that matches no rules', async () => {
      bm._localStore.shadowlog_rules = [makeRule({ urlRegex: ['facebook\\.com'] })];
      await RulesEngine.loadRules();
      const matches = RulesEngine.evaluateUrl('https://google.com');
      expect(matches).toEqual([]);
    });

    it('should return matching rules for a URL', async () => {
      bm._localStore.shadowlog_rules = [makeRule({ name: 'FB Rule', urlRegex: ['facebook\\.com'] })];
      await RulesEngine.loadRules();
      const matches = RulesEngine.evaluateUrl('https://facebook.com/profile');
      expect(matches).toHaveLength(1);
      expect(matches[0].ruleName).toBe('FB Rule');
    });

    it('should return ruleId, ruleName, actions, timing, and safety', async () => {
      const rule = makeRule({ id: 'r1', name: 'R1', urlRegex: ['test\\.com'] });
      bm._localStore.shadowlog_rules = [rule];
      await RulesEngine.loadRules();
      const matches = RulesEngine.evaluateUrl('https://test.com');
      expect(matches[0]).toHaveProperty('ruleId', 'r1');
      expect(matches[0]).toHaveProperty('ruleName', 'R1');
      expect(matches[0]).toHaveProperty('actions');
      expect(matches[0]).toHaveProperty('timing');
      expect(matches[0]).toHaveProperty('safety');
    });

    it('should match multiple rules for the same URL', async () => {
      bm._localStore.shadowlog_rules = [
        makeRule({ name: 'Broad', urlRegex: ['example'] }),
        makeRule({ name: 'Specific', urlRegex: ['example\\.com/page'] }),
      ];
      await RulesEngine.loadRules();
      const matches = RulesEngine.evaluateUrl('https://example.com/page');
      expect(matches).toHaveLength(2);
    });

    it('should exclude URLs that match an exclude pattern', async () => {
      bm._localStore.shadowlog_rules = [
        makeRule({
          urlRegex: ['example\\.com'],
          excludeRegex: ['example\\.com/keep'],
        }),
      ];
      await RulesEngine.loadRules();
      const matches = RulesEngine.evaluateUrl('https://example.com/keep/page');
      expect(matches).toHaveLength(0);
    });

    it('should not exclude URLs that do not match the exclude pattern', async () => {
      bm._localStore.shadowlog_rules = [
        makeRule({
          urlRegex: ['example\\.com'],
          excludeRegex: ['example\\.com/keep'],
        }),
      ];
      await RulesEngine.loadRules();
      const matches = RulesEngine.evaluateUrl('https://example.com/delete/page');
      expect(matches).toHaveLength(1);
    });

    it('should match case-insensitively', async () => {
      bm._localStore.shadowlog_rules = [makeRule({ urlRegex: ['example\\.com'] })];
      await RulesEngine.loadRules();
      const matches = RulesEngine.evaluateUrl('https://EXAMPLE.COM/page');
      expect(matches).toHaveLength(1);
    });

    it('should return empty when no rules are loaded', () => {
      const matches = RulesEngine.evaluateUrl('https://anything.com');
      expect(matches).toEqual([]);
    });
  });

  describe('mergeActions', () => {
    it('should return all keep when no matches', () => {
      const merged = RulesEngine.mergeActions([]);
      expect(merged).toEqual({ history: 'keep', cookies: 'keep', cache: 'keep', siteData: 'keep' });
    });

    it('should pass through actions from a single match', () => {
      const merged = RulesEngine.mergeActions([{
        actions: { history: 'delete', cookies: 'keep', cache: 'delete', siteData: 'keep' },
      }]);
      expect(merged.history).toBe('delete');
      expect(merged.cookies).toBe('keep');
      expect(merged.cache).toBe('delete');
      expect(merged.siteData).toBe('keep');
    });

    it('should merge with delete winning over keep', () => {
      const merged = RulesEngine.mergeActions([
        { actions: { history: 'delete', cookies: 'keep', cache: 'keep', siteData: 'keep' } },
        { actions: { history: 'keep', cookies: 'delete', cache: 'keep', siteData: 'keep' } },
      ]);
      expect(merged.history).toBe('delete');
      expect(merged.cookies).toBe('delete');
      expect(merged.cache).toBe('keep');
      expect(merged.siteData).toBe('keep');
    });

    it('should return all delete when all matches specify delete', () => {
      const merged = RulesEngine.mergeActions([
        { actions: { history: 'delete', cookies: 'delete', cache: 'delete', siteData: 'delete' } },
      ]);
      expect(merged).toEqual({ history: 'delete', cookies: 'delete', cache: 'delete', siteData: 'delete' });
    });

    it('should handle three matches with overlapping delete actions', () => {
      const merged = RulesEngine.mergeActions([
        { actions: { history: 'delete', cookies: 'keep', cache: 'keep', siteData: 'keep' } },
        { actions: { history: 'keep', cookies: 'keep', cache: 'delete', siteData: 'keep' } },
        { actions: { history: 'keep', cookies: 'keep', cache: 'keep', siteData: 'delete' } },
      ]);
      expect(merged).toEqual({ history: 'delete', cookies: 'keep', cache: 'delete', siteData: 'delete' });
    });
  });

  describe('mergeTiming', () => {
    it('should return all false/null when no matches', () => {
      const merged = RulesEngine.mergeTiming([]);
      expect(merged).toEqual({
        asap: false,
        onTabClose: false,
        onBrowserClose: false,
        periodicMinutes: null,
      });
    });

    it('should use OR logic for boolean timing fields', () => {
      const merged = RulesEngine.mergeTiming([
        { timing: { asap: true, onTabClose: false, onBrowserClose: false, periodicMinutes: null } },
        { timing: { asap: false, onTabClose: true, onBrowserClose: false, periodicMinutes: null } },
      ]);
      expect(merged.asap).toBe(true);
      expect(merged.onTabClose).toBe(true);
      expect(merged.onBrowserClose).toBe(false);
    });

    it('should take the minimum periodicMinutes', () => {
      const merged = RulesEngine.mergeTiming([
        { timing: { asap: false, onTabClose: false, onBrowserClose: false, periodicMinutes: 30 } },
        { timing: { asap: false, onTabClose: false, onBrowserClose: false, periodicMinutes: 10 } },
        { timing: { asap: false, onTabClose: false, onBrowserClose: false, periodicMinutes: 20 } },
      ]);
      expect(merged.periodicMinutes).toBe(10);
    });

    it('should keep periodicMinutes null when no match defines it', () => {
      const merged = RulesEngine.mergeTiming([
        { timing: { asap: true, onTabClose: false, onBrowserClose: false, periodicMinutes: null } },
      ]);
      expect(merged.periodicMinutes).toBeNull();
    });

    it('should handle a single match with periodicMinutes', () => {
      const merged = RulesEngine.mergeTiming([
        { timing: { asap: false, onTabClose: false, onBrowserClose: false, periodicMinutes: 15 } },
      ]);
      expect(merged.periodicMinutes).toBe(15);
    });

    it('should ignore null periodicMinutes when choosing minimum', () => {
      const merged = RulesEngine.mergeTiming([
        { timing: { asap: false, onTabClose: false, onBrowserClose: false, periodicMinutes: null } },
        { timing: { asap: false, onTabClose: false, onBrowserClose: false, periodicMinutes: 25 } },
      ]);
      expect(merged.periodicMinutes).toBe(25);
    });

    it('should OR all boolean fields across many matches', () => {
      const merged = RulesEngine.mergeTiming([
        { timing: { asap: false, onTabClose: false, onBrowserClose: true, periodicMinutes: null } },
        { timing: { asap: false, onTabClose: false, onBrowserClose: false, periodicMinutes: null } },
      ]);
      expect(merged.onBrowserClose).toBe(true);
    });
  });

  describe('getCompiledRules', () => {
    it('should return empty array after loadRules with no stored rules', () => {
      expect(RulesEngine.getCompiledRules()).toEqual([]);
    });

    it('should return the compiled rules after loadRules', async () => {
      bm._localStore.shadowlog_rules = [makeRule({ name: 'R1' })];
      await RulesEngine.loadRules();
      const rules = RulesEngine.getCompiledRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].name).toBe('R1');
    });

    it('should return the same reference as the internal array', async () => {
      bm._localStore.shadowlog_rules = [makeRule()];
      await RulesEngine.loadRules();
      const ref1 = RulesEngine.getCompiledRules();
      const ref2 = RulesEngine.getCompiledRules();
      expect(ref1).toBe(ref2);
    });
  });
});
