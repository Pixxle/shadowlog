'use strict';

window.ShadowLog = window.ShadowLog || {};

window.ShadowLog.RulesEngine = (() => {
  const { Constants } = window.ShadowLog;
  const { Storage } = window.ShadowLog;
  const { RuleSchema } = window.ShadowLog;

  let compiledRules = [];

  async function loadRules() {
    const rules = await Storage.getLocal(Constants.STORAGE_KEY_RULES, []);
    compiledRules = [];

    for (const rule of rules) {
      if (!rule.enabled) continue;

      const compiled = {
        id: rule.id,
        name: rule.name,
        urlRegexCompiled: [],
        excludeRegexCompiled: [],
        actions: rule.actions,
        timing: rule.timing,
        safety: rule.safety,
      };

      let valid = true;
      for (const pattern of rule.match.urlRegex) {
        const result = RuleSchema.compileRegex(pattern);
        if (result.regex) {
          compiled.urlRegexCompiled.push(result.regex);
        } else {
          console.warn(`ShadowLog: skipping rule "${rule.name}" — bad regex: ${pattern}`);
          valid = false;
          break;
        }
      }
      if (!valid) continue;

      for (const pattern of (rule.match.excludeRegex || [])) {
        const result = RuleSchema.compileRegex(pattern);
        if (result.regex) {
          compiled.excludeRegexCompiled.push(result.regex);
        }
        // Skip invalid exclude patterns silently — they just won't exclude
      }

      compiledRules.push(compiled);
    }

    console.log(`ShadowLog: loaded ${compiledRules.length} active rules`);
    return compiledRules;
  }

  function evaluateUrl(url) {
    const matches = [];

    for (const rule of compiledRules) {
      // Check if any urlRegex matches
      const urlMatches = rule.urlRegexCompiled.some(re => re.test(url));
      if (!urlMatches) continue;

      // Check if any excludeRegex excludes it
      const excluded = rule.excludeRegexCompiled.some(re => re.test(url));
      if (excluded) continue;

      matches.push({
        ruleId: rule.id,
        ruleName: rule.name,
        actions: rule.actions,
        timing: rule.timing,
        safety: rule.safety,
      });
    }

    return matches;
  }

  function mergeActions(matchResults) {
    const merged = {
      history: 'keep',
      cookies: 'keep',
      cache: 'keep',
      siteData: 'keep',
    };

    for (const match of matchResults) {
      for (const key of Object.keys(merged)) {
        if (match.actions[key] === 'delete') {
          merged[key] = 'delete';
        }
      }
    }

    return merged;
  }

  function mergeTiming(matchResults) {
    const merged = {
      asap: false,
      onTabClose: false,
      onBrowserClose: false,
      periodicMinutes: null,
    };

    for (const match of matchResults) {
      if (match.timing.asap) merged.asap = true;
      if (match.timing.onTabClose) merged.onTabClose = true;
      if (match.timing.onBrowserClose) merged.onBrowserClose = true;
      if (match.timing.periodicMinutes != null) {
        if (merged.periodicMinutes == null || match.timing.periodicMinutes < merged.periodicMinutes) {
          merged.periodicMinutes = match.timing.periodicMinutes;
        }
      }
    }

    return merged;
  }

  function getCompiledRules() {
    return compiledRules;
  }

  return { loadRules, evaluateUrl, mergeActions, mergeTiming, getCompiledRules };
})();
