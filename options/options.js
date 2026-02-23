'use strict';

(() => {
  const { Constants } = window.ShadowLog;
  const { RuleSchema } = window.ShadowLog;

  // --- State ---
  let rules = [];
  let editingRuleId = null; // null = new rule

  // --- DOM refs ---
  const ruleListEl = document.getElementById('rule-list');
  const editorEl = document.getElementById('editor');
  const editorTitle = document.getElementById('editor-title');
  const editorErrors = document.getElementById('editor-errors');
  const editorPlaceholder = document.getElementById('editor-placeholder');

  const fieldName = document.getElementById('field-name');
  const fieldUrlRegex = document.getElementById('field-url-regex');
  const fieldExcludeRegex = document.getElementById('field-exclude-regex');
  const regexValidation = document.getElementById('regex-validation');

  const actionHistory = document.getElementById('action-history');
  const actionCookies = document.getElementById('action-cookies');
  const actionCache = document.getElementById('action-cache');
  const actionSiteData = document.getElementById('action-sitedata');

  const timingAsap = document.getElementById('timing-asap');
  const timingTabClose = document.getElementById('timing-tab-close');
  const timingBrowserClose = document.getElementById('timing-browser-close');
  const timingPeriodic = document.getElementById('timing-periodic');

  const safetyRate = document.getElementById('safety-rate');
  const safetyCooldown = document.getElementById('safety-cooldown');

  const btnAddRule = document.getElementById('btn-add-rule');
  const btnSave = document.getElementById('btn-save');
  const btnCancel = document.getElementById('btn-cancel');
  const btnImport = document.getElementById('btn-import');
  const btnExport = document.getElementById('btn-export');
  const importFile = document.getElementById('import-file');

  const testUrlInput = document.getElementById('test-url');
  const btnTest = document.getElementById('btn-test');
  const testResults = document.getElementById('test-results');

  // --- Init ---

  async function init() {
    rules = await loadRules();
    renderRuleList();
    setupEventListeners();
  }

  async function loadRules() {
    const result = await browser.storage.local.get(Constants.STORAGE_KEY_RULES);
    return result[Constants.STORAGE_KEY_RULES] || [];
  }

  async function saveRules() {
    await browser.storage.local.set({ [Constants.STORAGE_KEY_RULES]: rules });
  }

  // --- Rule list rendering ---

  function renderRuleList() {
    if (rules.length === 0) {
      ruleListEl.innerHTML = '<p class="empty-state">No rules yet. Click "+ New Rule" to get started.</p>';
      return;
    }

    ruleListEl.innerHTML = '';
    for (const rule of rules) {
      const item = document.createElement('div');
      item.className = 'rule-item' +
        (rule.id === editingRuleId ? ' selected' : '') +
        (!rule.enabled ? ' disabled' : '');
      item.dataset.ruleId = rule.id;

      // Toggle
      const toggle = document.createElement('label');
      toggle.className = 'toggle rule-toggle';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = rule.enabled;
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        toggleRule(rule.id);
      });
      const slider = document.createElement('span');
      slider.className = 'slider';
      toggle.appendChild(checkbox);
      toggle.appendChild(slider);

      // Info
      const info = document.createElement('div');
      info.className = 'rule-info';
      const nameEl = document.createElement('div');
      nameEl.className = 'rule-name';
      nameEl.textContent = rule.name || '(unnamed)';
      const patternsEl = document.createElement('div');
      patternsEl.className = 'rule-patterns';
      patternsEl.textContent = rule.match.urlRegex.join(', ') || '(no patterns)';
      info.appendChild(nameEl);
      info.appendChild(patternsEl);

      // Delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'rule-delete';
      deleteBtn.textContent = '\u2715';
      deleteBtn.title = 'Delete rule';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteRule(rule.id);
      });

      item.appendChild(toggle);
      item.appendChild(info);
      item.appendChild(deleteBtn);

      item.addEventListener('click', () => openRuleEditor(rule.id));

      ruleListEl.appendChild(item);
    }
  }

  // --- Rule editor ---

  function openRuleEditor(ruleId = null) {
    editingRuleId = ruleId;
    editorEl.classList.remove('hidden');
    editorPlaceholder.classList.add('hidden');
    editorErrors.classList.add('hidden');

    if (ruleId) {
      const rule = rules.find(r => r.id === ruleId);
      if (!rule) return;
      editorTitle.textContent = 'Edit Rule';
      populateEditor(rule);
    } else {
      editorTitle.textContent = 'New Rule';
      const blank = RuleSchema.createRule();
      populateEditor(blank);
    }

    renderRuleList(); // Update selected state
  }

  function populateEditor(rule) {
    fieldName.value = rule.name;
    fieldUrlRegex.value = rule.match.urlRegex.join('\n');
    fieldExcludeRegex.value = (rule.match.excludeRegex || []).join('\n');

    actionHistory.checked = rule.actions.history === 'delete';
    actionCookies.checked = rule.actions.cookies === 'delete';
    actionCache.checked = rule.actions.cache === 'delete';
    actionSiteData.checked = rule.actions.siteData === 'delete';

    timingAsap.checked = rule.timing.asap;
    timingTabClose.checked = rule.timing.onTabClose;
    timingBrowserClose.checked = rule.timing.onBrowserClose;
    timingPeriodic.value = rule.timing.periodicMinutes != null ? rule.timing.periodicMinutes : '';

    safetyRate.value = rule.safety.maxDeletesPerMinute;
    safetyCooldown.value = rule.safety.cooldownSeconds;

    validateRegexFields();
  }

  function readEditorValues() {
    const urlRegex = fieldUrlRegex.value.split('\n').map(s => s.trim()).filter(Boolean);
    const excludeRegex = fieldExcludeRegex.value.split('\n').map(s => s.trim()).filter(Boolean);
    const periodicVal = timingPeriodic.value.trim();

    return {
      name: fieldName.value.trim(),
      match: { urlRegex, excludeRegex },
      actions: {
        history: actionHistory.checked ? 'delete' : 'keep',
        cookies: actionCookies.checked ? 'delete' : 'keep',
        cache: actionCache.checked ? 'delete' : 'keep',
        siteData: actionSiteData.checked ? 'delete' : 'keep',
      },
      timing: {
        asap: timingAsap.checked,
        onTabClose: timingTabClose.checked,
        onBrowserClose: timingBrowserClose.checked,
        periodicMinutes: periodicVal ? parseInt(periodicVal, 10) : null,
      },
      safety: {
        maxDeletesPerMinute: parseInt(safetyRate.value, 10) || Constants.DEFAULT_MAX_DELETES_PER_MINUTE,
        cooldownSeconds: parseInt(safetyCooldown.value, 10) || 0,
      },
    };
  }

  async function saveRule() {
    const values = readEditorValues();
    let rule;

    if (editingRuleId) {
      rule = rules.find(r => r.id === editingRuleId);
      if (!rule) return;
      Object.assign(rule, values);
      rule.updatedAt = Date.now();
    } else {
      rule = RuleSchema.createRule(values);
      rules.push(rule);
      editingRuleId = rule.id;
    }

    const validation = RuleSchema.validateRule(rule);
    if (!validation.valid) {
      showEditorErrors(validation.errors);
      return;
    }

    await saveRules();
    editorErrors.classList.add('hidden');
    renderRuleList();
  }

  function showEditorErrors(errors) {
    editorErrors.textContent = '';
    const strong = document.createElement('strong');
    strong.textContent = 'Please fix:';
    const ul = document.createElement('ul');
    for (const e of errors) {
      const li = document.createElement('li');
      li.textContent = e;
      ul.appendChild(li);
    }
    editorErrors.appendChild(strong);
    editorErrors.appendChild(ul);
    editorErrors.classList.remove('hidden');
  }

  function closeEditor() {
    editingRuleId = null;
    editorEl.classList.add('hidden');
    editorPlaceholder.classList.remove('hidden');
    editorErrors.classList.add('hidden');
    renderRuleList();
  }

  // --- Rule operations ---

  async function toggleRule(ruleId) {
    const rule = rules.find(r => r.id === ruleId);
    if (!rule) return;
    rule.enabled = !rule.enabled;
    rule.updatedAt = Date.now();
    await saveRules();
    renderRuleList();
  }

  async function deleteRule(ruleId) {
    const rule = rules.find(r => r.id === ruleId);
    if (!rule) return;
    if (!confirm(`Delete rule "${rule.name}"?`)) return;

    rules = rules.filter(r => r.id !== ruleId);
    await saveRules();

    if (editingRuleId === ruleId) {
      closeEditor();
    }
    renderRuleList();
  }

  // --- Live regex validation ---

  function validateRegexFields() {
    const lines = fieldUrlRegex.value.split('\n').filter(l => l.trim());
    regexValidation.innerHTML = '';

    for (const line of lines) {
      const pattern = line.trim();
      if (!pattern) continue;
      const result = RuleSchema.compileRegex(pattern);
      const el = document.createElement('div');
      if (result.error) {
        el.className = 'invalid';
        el.textContent = `\u2717 ${pattern}: ${result.error}`;
      } else {
        el.className = 'valid';
        el.textContent = `\u2713 ${pattern}`;
      }
      regexValidation.appendChild(el);
    }
  }

  // --- Import / Export ---

  function exportRules() {
    const json = JSON.stringify(rules, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shadowlog-rules-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importRules(file) {
    try {
      const text = await file.text();
      const imported = JSON.parse(text);

      if (!Array.isArray(imported)) {
        alert('Invalid file: expected an array of rules');
        return;
      }

      let validCount = 0;
      let errorCount = 0;

      for (const item of imported) {
        const rule = RuleSchema.createRule(item);
        const validation = RuleSchema.validateRule(rule);
        if (validation.valid) {
          // Check for duplicate ID
          const existingIdx = rules.findIndex(r => r.id === rule.id);
          if (existingIdx !== -1) {
            rules[existingIdx] = rule; // Overwrite
          } else {
            rules.push(rule);
          }
          validCount++;
        } else {
          errorCount++;
        }
      }

      await saveRules();
      renderRuleList();
      alert(`Imported ${validCount} rules${errorCount > 0 ? `, ${errorCount} skipped (invalid)` : ''}`);
    } catch (err) {
      alert('Failed to import: ' + err.message);
    }
  }

  // --- URL Test Tool ---

  async function testUrl() {
    const url = testUrlInput.value.trim();
    if (!url) return;

    testResults.classList.remove('hidden');

    try {
      const result = await browser.runtime.sendMessage({ type: 'TEST_URL', url });

      if (!result.matches || result.matches.length === 0) {
        testResults.textContent = '';
        const noMatch = document.createElement('div');
        noMatch.className = 'test-no-match';
        noMatch.textContent = 'No rules match this URL.';
        testResults.appendChild(noMatch);
        return;
      }

      const frag = document.createDocumentFragment();

      for (const match of result.matches) {
        const div = document.createElement('div');
        div.className = 'test-match';
        const span = document.createElement('span');
        span.className = 'test-match-rule';
        span.textContent = match.ruleName;
        div.appendChild(span);
        frag.appendChild(div);
      }

      if (result.mergedActions) {
        const actDiv = document.createElement('div');
        actDiv.className = 'test-actions';
        const actLabel = document.createElement('strong');
        actLabel.textContent = 'Actions:';
        actDiv.appendChild(actLabel);
        actDiv.append(' ');
        for (const [key, value] of Object.entries(result.mergedActions)) {
          const span = document.createElement('span');
          span.className = `test-action ${value}`;
          span.textContent = `${key}: ${value}`;
          actDiv.appendChild(span);
        }
        frag.appendChild(actDiv);
      }

      if (result.mergedTiming) {
        const timDiv = document.createElement('div');
        timDiv.className = 'test-actions';
        const timLabel = document.createElement('strong');
        timLabel.textContent = 'Timing:';
        timDiv.appendChild(timLabel);
        timDiv.append(' ');
        const timings = [];
        if (result.mergedTiming.asap) timings.push('ASAP');
        if (result.mergedTiming.onTabClose) timings.push('On tab close');
        if (result.mergedTiming.onBrowserClose) timings.push('On browser close');
        if (result.mergedTiming.periodicMinutes) timings.push(`Every ${result.mergedTiming.periodicMinutes}min`);
        timDiv.append(timings.join(', ') || 'none');
        frag.appendChild(timDiv);
      }

      if (result.hostname) {
        const originDiv = document.createElement('div');
        originDiv.className = 'test-origin';
        originDiv.append('Origin: ');
        const code = document.createElement('code');
        code.textContent = result.hostname;
        originDiv.appendChild(code);
        if (result.hostnames && result.hostnames.length > 1) {
          originDiv.append(' (also: ');
          result.hostnames.slice(1).forEach((h, i) => {
            if (i > 0) originDiv.append(', ');
            const c = document.createElement('code');
            c.textContent = h;
            originDiv.appendChild(c);
          });
          originDiv.append(')');
        }
        frag.appendChild(originDiv);
      }

      testResults.textContent = '';
      testResults.appendChild(frag);
    } catch (err) {
      testResults.textContent = '';
      const errDiv = document.createElement('div');
      errDiv.className = 'test-no-match';
      errDiv.textContent = `Error: ${err.message}`;
      testResults.appendChild(errDiv);
    }
  }

  // --- Event listeners ---

  function setupEventListeners() {
    btnAddRule.addEventListener('click', () => openRuleEditor(null));
    btnSave.addEventListener('click', saveRule);
    btnCancel.addEventListener('click', closeEditor);
    btnExport.addEventListener('click', exportRules);
    btnImport.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', (e) => {
      if (e.target.files[0]) {
        importRules(e.target.files[0]);
        e.target.value = '';
      }
    });
    btnTest.addEventListener('click', testUrl);
    testUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') testUrl();
    });

    // Live regex validation
    fieldUrlRegex.addEventListener('input', validateRegexFields);
    fieldExcludeRegex.addEventListener('input', validateRegexFields);
  }

  // --- Helpers ---

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Go ---
  init();
})();
