'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// Ordered list matching manifest.json background.scripts (minus main.js)
const SHARED_MODULES = [
  'shared/constants.js',
  'shared/rule-schema.js',
  'shared/storage-helpers.js',
];

const BACKGROUND_MODULES = [
  ...SHARED_MODULES,
  'background/rules-engine.js',
  'background/deletion-engine.js',
  'background/buffer.js',
  'background/tab-tracker.js',
  'background/scheduler.js',
];

/**
 * Ensure crypto.randomUUID and structuredClone exist in the test env.
 */
function ensurePolyfills() {
  if (!globalThis.crypto) {
    globalThis.crypto = {};
  }
  if (!globalThis.crypto.randomUUID) {
    globalThis.crypto.randomUUID = () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
    };
  }
  if (!globalThis.structuredClone) {
    globalThis.structuredClone = (obj) => JSON.parse(JSON.stringify(obj));
  }
}

/**
 * Execute a source file in the current context.
 * Uses indirect eval instead of require so the file is always
 * re-evaluated (Jest's module cache makes require-cache busting unreliable).
 */
function loadSource(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  const code = fs.readFileSync(fullPath, 'utf8');
  // Indirect eval runs in the global scope where Jest's jsdom globals live
  (0, eval)(code);
  return window.ShadowLog;
}

/**
 * Reset the ShadowLog namespace so modules can be cleanly re-loaded.
 */
function clearAllModules() {
  if (typeof window !== 'undefined') {
    window.ShadowLog = {};
  }
}

/**
 * Load only shared modules.
 */
function loadSharedModules() {
  ensurePolyfills();
  window.ShadowLog = {};
  for (const mod of SHARED_MODULES) {
    loadSource(mod);
  }
  return window.ShadowLog;
}

/**
 * Load all shared + background modules (except main.js) in order.
 */
function loadAllBackgroundModules() {
  ensurePolyfills();
  window.ShadowLog = {};
  for (const mod of BACKGROUND_MODULES) {
    loadSource(mod);
  }
  return window.ShadowLog;
}

/**
 * Load main.js after all other modules are loaded.
 */
function loadMainModule() {
  loadSource('background/main.js');
}

module.exports = {
  ROOT,
  loadSource,
  clearAllModules,
  loadSharedModules,
  loadAllBackgroundModules,
  loadMainModule,
  ensurePolyfills,
  SHARED_MODULES,
  BACKGROUND_MODULES,
};
