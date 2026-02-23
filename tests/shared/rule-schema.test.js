'use strict';

const { createBrowserMock, installBrowserMock } = require('../helpers/browser-mock');
const { loadSource, ensurePolyfills } = require('../helpers/module-loader');

describe('ShadowLog.RuleSchema', () => {
  let RuleSchema;

  beforeEach(() => {
    ensurePolyfills();
    installBrowserMock(createBrowserMock());
    window.ShadowLog = {};
    loadSource('shared/constants.js');
    loadSource('shared/rule-schema.js');
    RuleSchema = window.ShadowLog.RuleSchema;
  });

  describe('compileRegex', () => {
    it('should return a regex and no error for a valid pattern', () => {
      const result = RuleSchema.compileRegex('foo\\.com');
      expect(result.regex).toBeInstanceOf(RegExp);
      expect(result.error).toBeNull();
    });

    it('should return case-insensitive regex', () => {
      const result = RuleSchema.compileRegex('foo');
      expect(result.regex.flags).toContain('i');
    });

    it('should return null regex and error for an invalid pattern', () => {
      const result = RuleSchema.compileRegex('[invalid');
      expect(result.regex).toBeNull();
      expect(typeof result.error).toBe('string');
      expect(result.error.length).toBeGreaterThan(0);
    });

    it('should return error for null input', () => {
      const result = RuleSchema.compileRegex(null);
      expect(result.regex).toBeNull();
      expect(result.error).toBe('Pattern must be a non-empty string');
    });

    it('should return error for empty string', () => {
      const result = RuleSchema.compileRegex('');
      expect(result.regex).toBeNull();
      expect(result.error).toBe('Pattern must be a non-empty string');
    });

    it('should return error for non-string input', () => {
      const result = RuleSchema.compileRegex(42);
      expect(result.regex).toBeNull();
      expect(result.error).toBe('Pattern must be a non-empty string');
    });

    it('should handle complex valid patterns', () => {
      const result = RuleSchema.compileRegex('https?://.*\\.example\\.(com|org)/\\w+');
      expect(result.regex).toBeInstanceOf(RegExp);
      expect(result.error).toBeNull();
    });
  });

  describe('createRule', () => {
    it('should return a rule with all required fields', () => {
      const rule = RuleSchema.createRule();
      expect(rule.id).toBeDefined();
      expect(rule.name).toBeDefined();
      expect(typeof rule.enabled).toBe('boolean');
      expect(rule.match).toBeDefined();
      expect(rule.actions).toBeDefined();
      expect(rule.timing).toBeDefined();
      expect(rule.safety).toBeDefined();
      expect(typeof rule.createdAt).toBe('number');
      expect(typeof rule.updatedAt).toBe('number');
    });

    it('should generate a unique UUID for the id', () => {
      const rule1 = RuleSchema.createRule();
      const rule2 = RuleSchema.createRule();
      expect(rule1.id).not.toBe(rule2.id);
    });

    it('should set enabled to true by default', () => {
      expect(RuleSchema.createRule().enabled).toBe(true);
    });

    it('should set default actions with history=delete and others=keep', () => {
      const rule = RuleSchema.createRule();
      expect(rule.actions.history).toBe('delete');
      expect(rule.actions.cookies).toBe('keep');
      expect(rule.actions.cache).toBe('keep');
      expect(rule.actions.siteData).toBe('keep');
    });

    it('should set timing.asap to true by default', () => {
      const rule = RuleSchema.createRule();
      expect(rule.timing.asap).toBe(true);
      expect(rule.timing.onTabClose).toBe(false);
      expect(rule.timing.onBrowserClose).toBe(false);
      expect(rule.timing.periodicMinutes).toBeNull();
    });

    it('should set safety defaults from Constants', () => {
      const rule = RuleSchema.createRule();
      expect(rule.safety.maxDeletesPerMinute).toBe(60);
      expect(rule.safety.cooldownSeconds).toBe(0);
    });

    it('should override the id when provided', () => {
      const rule = RuleSchema.createRule({ id: 'my-id' });
      expect(rule.id).toBe('my-id');
    });

    it('should override the name when provided', () => {
      const rule = RuleSchema.createRule({ name: 'Test Rule' });
      expect(rule.name).toBe('Test Rule');
    });

    it('should override enabled when provided as false', () => {
      const rule = RuleSchema.createRule({ enabled: false });
      expect(rule.enabled).toBe(false);
    });

    it('should deep-merge match.urlRegex', () => {
      const rule = RuleSchema.createRule({ match: { urlRegex: ['foo\\.com'] } });
      expect(rule.match.urlRegex).toEqual(['foo\\.com']);
      expect(rule.match.excludeRegex).toEqual([]);
    });

    it('should deep-merge match.excludeRegex', () => {
      const rule = RuleSchema.createRule({ match: { excludeRegex: ['bar\\.com'] } });
      expect(rule.match.excludeRegex).toEqual(['bar\\.com']);
    });

    it('should override actions', () => {
      const rule = RuleSchema.createRule({ actions: { cookies: 'delete' } });
      expect(rule.actions.cookies).toBe('delete');
      expect(rule.actions.history).toBe('delete'); // preserved default
    });

    it('should override timing', () => {
      const rule = RuleSchema.createRule({ timing: { onTabClose: true } });
      expect(rule.timing.onTabClose).toBe(true);
      expect(rule.timing.asap).toBe(true); // preserved default
    });

    it('should override safety', () => {
      const rule = RuleSchema.createRule({ safety: { maxDeletesPerMinute: 10 } });
      expect(rule.safety.maxDeletesPerMinute).toBe(10);
    });
  });

  describe('validateRule', () => {
    function validRule(overrides = {}) {
      return RuleSchema.createRule({
        name: 'Test',
        match: { urlRegex: ['foo\\.com'] },
        ...overrides,
      });
    }

    it('should return valid:true for a well-formed rule', () => {
      const result = RuleSchema.validateRule(validRule());
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should require a string id', () => {
      const rule = validRule();
      rule.id = null;
      const result = RuleSchema.validateRule(rule);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('id'))).toBe(true);
    });

    it('should require a non-empty name', () => {
      const rule = validRule({ name: '' });
      // createRule won't allow empty name override easily, set it manually
      rule.name = '';
      const result = RuleSchema.validateRule(rule);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('name'))).toBe(true);
    });

    it('should require name not be only whitespace', () => {
      const rule = validRule();
      rule.name = '   ';
      const result = RuleSchema.validateRule(rule);
      expect(result.valid).toBe(false);
    });

    it('should require at least one URL regex pattern', () => {
      const rule = validRule();
      rule.match.urlRegex = [];
      const result = RuleSchema.validateRule(rule);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('regex'))).toBe(true);
    });

    it('should validate URL regex patterns', () => {
      const rule = validRule();
      rule.match.urlRegex = ['[invalid'];
      const result = RuleSchema.validateRule(rule);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('[invalid'))).toBe(true);
    });

    it('should accept valid URL regex patterns', () => {
      const rule = validRule();
      rule.match.urlRegex = ['foo\\.com', 'bar\\.org'];
      const result = RuleSchema.validateRule(rule);
      expect(result.valid).toBe(true);
    });

    it('should validate exclude regex patterns when present', () => {
      const rule = validRule();
      rule.match.excludeRegex = ['[bad'];
      const result = RuleSchema.validateRule(rule);
      expect(result.valid).toBe(false);
    });

    it('should accept valid exclude regex patterns', () => {
      const rule = validRule();
      rule.match.excludeRegex = ['safe\\.com'];
      expect(RuleSchema.validateRule(rule).valid).toBe(true);
    });

    it('should allow empty excludeRegex array', () => {
      const rule = validRule();
      rule.match.excludeRegex = [];
      expect(RuleSchema.validateRule(rule).valid).toBe(true);
    });

    it('should require action values to be "delete" or "keep"', () => {
      const rule = validRule();
      rule.actions.history = 'purge';
      const result = RuleSchema.validateRule(rule);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('purge'))).toBe(true);
    });

    it('should require at least one action set to "delete"', () => {
      const rule = validRule();
      rule.actions = { history: 'keep', cookies: 'keep', cache: 'keep', siteData: 'keep' };
      const result = RuleSchema.validateRule(rule);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('delete'))).toBe(true);
    });

    it('should require at least one timing trigger', () => {
      const rule = validRule();
      rule.timing = { asap: false, onTabClose: false, onBrowserClose: false, periodicMinutes: null };
      const result = RuleSchema.validateRule(rule);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('timing'))).toBe(true);
    });

    it('should accept periodicMinutes as the sole timing trigger', () => {
      const rule = validRule();
      rule.timing = { asap: false, onTabClose: false, onBrowserClose: false, periodicMinutes: 5 };
      expect(RuleSchema.validateRule(rule).valid).toBe(true);
    });

    it('should reject periodicMinutes less than 1', () => {
      const rule = validRule();
      rule.timing.periodicMinutes = 0;
      const result = RuleSchema.validateRule(rule);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('periodicMinutes'))).toBe(true);
    });

    it('should require maxDeletesPerMinute to be a positive number', () => {
      const rule = validRule();
      rule.safety.maxDeletesPerMinute = 0;
      const result = RuleSchema.validateRule(rule);
      expect(result.valid).toBe(false);
    });

    it('should require cooldownSeconds to be non-negative', () => {
      const rule = validRule();
      rule.safety.cooldownSeconds = -1;
      const result = RuleSchema.validateRule(rule);
      expect(result.valid).toBe(false);
    });

    it('should accept cooldownSeconds of 0', () => {
      const rule = validRule();
      rule.safety.cooldownSeconds = 0;
      expect(RuleSchema.validateRule(rule).valid).toBe(true);
    });

    it('should collect multiple errors at once', () => {
      const rule = validRule();
      rule.name = '';
      rule.match.urlRegex = [];
      rule.actions = { history: 'keep', cookies: 'keep', cache: 'keep', siteData: 'keep' };
      const result = RuleSchema.validateRule(rule);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });
});
