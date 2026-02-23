'use strict';

window.ShadowLog = window.ShadowLog || {};

window.ShadowLog.TabTracker = (() => {
  const { Constants } = window.ShadowLog;
  const { Storage } = window.ShadowLog;

  async function getMap() {
    return Storage.getSession(Constants.SESSION_KEY_TAB_MAP, {});
  }

  async function setMap(map) {
    return Storage.setSession(Constants.SESSION_KEY_TAB_MAP, map);
  }

  async function trackNavigation(tabId, url) {
    const map = await getMap();
    map[tabId] = { url, timestamp: Date.now() };
    await setMap(map);
  }

  async function getTabUrl(tabId) {
    const map = await getMap();
    const entry = map[tabId];
    return entry ? entry.url : null;
  }

  async function removeTab(tabId) {
    const map = await getMap();
    delete map[tabId];
    await setMap(map);
  }

  async function getAllTracked() {
    return getMap();
  }

  return { trackNavigation, getTabUrl, removeTab, getAllTracked };
})();
