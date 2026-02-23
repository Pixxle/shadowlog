'use strict';

window.ShadowLog = window.ShadowLog || {};

window.ShadowLog.RuleSchema = (() => {

  function createRule(overrides = {}) {
    const base = {
      id: crypto.randomUUID(),
      name: '',
      enabled: true,
      match: {
        urlRegex: [],
        excludeRegex: [],
      },
      actions: {
        history: 'delete',
        cookies: 'keep',
        cache: 'keep',
        siteData: 'keep',
      },
      timing: {
        asap: true,
        onTabClose: false,
        onBrowserClose: false,
        periodicMinutes: null,
      },
      safety: {
        maxDeletesPerMinute: window.ShadowLog.Constants.DEFAULT_MAX_DELETES_PER_MINUTE,
        cooldownSeconds: window.ShadowLog.Constants.DEFAULT_COOLDOWN_SECONDS,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Deep merge overrides
    const rule = structuredClone(base);
    if (overrides.id) rule.id = overrides.id;
    if (overrides.name != null) rule.name = overrides.name;
    if (overrides.enabled != null) rule.enabled = overrides.enabled;
    if (overrides.match) {
      if (overrides.match.urlRegex) rule.match.urlRegex = overrides.match.urlRegex;
      if (overrides.match.excludeRegex) rule.match.excludeRegex = overrides.match.excludeRegex;
    }
    if (overrides.actions) Object.assign(rule.actions, overrides.actions);
    if (overrides.timing) Object.assign(rule.timing, overrides.timing);
    if (overrides.safety) Object.assign(rule.safety, overrides.safety);

    return rule;
  }

  function validateRule(rule) {
    const errors = [];

    if (!rule.id || typeof rule.id !== 'string') {
      errors.push('Rule must have a string id');
    }
    if (!rule.name || typeof rule.name !== 'string' || rule.name.trim() === '') {
      errors.push('Rule must have a non-empty name');
    }
    if (!rule.match || !Array.isArray(rule.match.urlRegex) || rule.match.urlRegex.length === 0) {
      errors.push('Rule must have at least one URL regex pattern');
    } else {
      for (const pattern of rule.match.urlRegex) {
        const result = compileRegex(pattern);
        if (result.error) {
          errors.push(`Invalid URL regex "${pattern}": ${result.error}`);
        }
      }
    }
    if (rule.match && Array.isArray(rule.match.excludeRegex)) {
      for (const pattern of rule.match.excludeRegex) {
        const result = compileRegex(pattern);
        if (result.error) {
          errors.push(`Invalid exclude regex "${pattern}": ${result.error}`);
        }
      }
    }

    const validActionValues = ['delete', 'keep'];
    if (rule.actions) {
      for (const [key, value] of Object.entries(rule.actions)) {
        if (!validActionValues.includes(value)) {
          errors.push(`Invalid action value "${value}" for "${key}". Must be "delete" or "keep".`);
        }
      }
      const hasAnyDelete = Object.values(rule.actions).some(v => v === 'delete');
      if (!hasAnyDelete) {
        errors.push('Rule must have at least one action set to "delete"');
      }
    }

    if (rule.timing) {
      const hasAnyTiming = rule.timing.asap || rule.timing.onTabClose ||
        rule.timing.onBrowserClose || (rule.timing.periodicMinutes != null && rule.timing.periodicMinutes > 0);
      if (!hasAnyTiming) {
        errors.push('Rule must have at least one timing trigger enabled');
      }
      if (rule.timing.periodicMinutes != null) {
        if (typeof rule.timing.periodicMinutes !== 'number' || rule.timing.periodicMinutes < 1) {
          errors.push('periodicMinutes must be a number >= 1');
        }
      }
    }

    if (rule.safety) {
      if (typeof rule.safety.maxDeletesPerMinute !== 'number' || rule.safety.maxDeletesPerMinute < 1) {
        errors.push('maxDeletesPerMinute must be a positive number');
      }
      if (typeof rule.safety.cooldownSeconds !== 'number' || rule.safety.cooldownSeconds < 0) {
        errors.push('cooldownSeconds must be a non-negative number');
      }
    }

    return { valid: errors.length === 0, errors };
  }

  function compileRegex(pattern) {
    if (!pattern || typeof pattern !== 'string') {
      return { regex: null, error: 'Pattern must be a non-empty string' };
    }
    try {
      const regex = new RegExp(pattern, 'i');
      return { regex, error: null };
    } catch (e) {
      return { regex: null, error: e.message };
    }
  }

  return { createRule, validateRule, compileRegex };
})();
