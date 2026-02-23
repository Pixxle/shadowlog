'use strict';

window.ShadowLog = window.ShadowLog || {};

window.ShadowLog.Storage = (() => {

  // Fallback in-memory map if storage.session is unavailable
  const sessionFallback = new Map();
  const hasSessionStorage = typeof browser !== 'undefined' &&
    browser.storage && browser.storage.session;

  async function getLocal(key, defaultValue = null) {
    const result = await browser.storage.local.get(key);
    return result[key] !== undefined ? result[key] : defaultValue;
  }

  async function setLocal(key, value) {
    await browser.storage.local.set({ [key]: value });
  }

  async function removeLocal(key) {
    await browser.storage.local.remove(key);
  }

  async function getSession(key, defaultValue = null) {
    if (!hasSessionStorage) {
      const val = sessionFallback.get(key);
      return val !== undefined ? val : defaultValue;
    }
    const result = await browser.storage.session.get(key);
    return result[key] !== undefined ? result[key] : defaultValue;
  }

  async function setSession(key, value) {
    if (!hasSessionStorage) {
      sessionFallback.set(key, value);
      return;
    }
    await browser.storage.session.set({ [key]: value });
  }

  async function removeSession(key) {
    if (!hasSessionStorage) {
      sessionFallback.delete(key);
      return;
    }
    await browser.storage.session.remove(key);
  }

  async function updateLocal(key, updaterFn, defaultValue = null) {
    const current = await getLocal(key, defaultValue);
    const updated = updaterFn(current);
    await setLocal(key, updated);
    return updated;
  }

  return { getLocal, setLocal, removeLocal, getSession, setSession, removeSession, updateLocal };
})();
