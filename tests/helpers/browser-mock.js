'use strict';

function createEvent() {
  const listeners = [];
  return {
    addListener: jest.fn((cb) => listeners.push(cb)),
    removeListener: jest.fn((cb) => {
      const idx = listeners.indexOf(cb);
      if (idx !== -1) listeners.splice(idx, 1);
    }),
    hasListener: jest.fn((cb) => listeners.includes(cb)),
    _fire(...args) {
      const results = [];
      for (const cb of listeners) {
        results.push(cb(...args));
      }
      return results;
    },
    _listeners: listeners,
  };
}

function createBrowserMock() {
  const localStore = {};
  const sessionStore = {};
  const alarms = {};

  const mock = {
    storage: {
      local: {
        get: jest.fn(async (key) => {
          if (typeof key === 'string') {
            return { [key]: localStore[key] };
          }
          if (Array.isArray(key)) {
            const result = {};
            for (const k of key) {
              if (localStore[k] !== undefined) result[k] = localStore[k];
            }
            return result;
          }
          return {};
        }),
        set: jest.fn(async (obj) => {
          Object.assign(localStore, obj);
        }),
        remove: jest.fn(async (key) => {
          if (typeof key === 'string') {
            delete localStore[key];
          } else if (Array.isArray(key)) {
            for (const k of key) delete localStore[k];
          }
        }),
      },
      session: {
        get: jest.fn(async (key) => {
          if (typeof key === 'string') {
            return { [key]: sessionStore[key] };
          }
          if (Array.isArray(key)) {
            const result = {};
            for (const k of key) {
              if (sessionStore[k] !== undefined) result[k] = sessionStore[k];
            }
            return result;
          }
          return {};
        }),
        set: jest.fn(async (obj) => {
          Object.assign(sessionStore, obj);
        }),
        remove: jest.fn(async (key) => {
          if (typeof key === 'string') {
            delete sessionStore[key];
          } else if (Array.isArray(key)) {
            for (const k of key) delete sessionStore[k];
          }
        }),
      },
      onChanged: createEvent(),
    },
    history: {
      deleteUrl: jest.fn(async () => {}),
      search: jest.fn(async () => []),
      onVisited: createEvent(),
    },
    browsingData: {
      remove: jest.fn(async () => {}),
    },
    alarms: {
      create: jest.fn((name, opts) => {
        alarms[name] = { name, ...opts };
      }),
      get: jest.fn(async (name) => alarms[name] || null),
      getAll: jest.fn(async () => Object.values(alarms)),
      clear: jest.fn(async (name) => {
        const existed = !!alarms[name];
        delete alarms[name];
        return existed;
      }),
      clearAll: jest.fn(async () => {
        for (const k of Object.keys(alarms)) delete alarms[k];
      }),
      onAlarm: createEvent(),
    },
    webNavigation: {
      onCommitted: createEvent(),
      onCompleted: createEvent(),
    },
    tabs: {
      query: jest.fn(async () => []),
      onRemoved: createEvent(),
    },
    windows: {
      getAll: jest.fn(async () => []),
      onRemoved: createEvent(),
    },
    runtime: {
      sendMessage: jest.fn(async () => ({})),
      onMessage: createEvent(),
      onStartup: createEvent(),
      onInstalled: createEvent(),
      openOptionsPage: jest.fn(),
    },

    // Test helpers for direct state inspection/seeding
    _localStore: localStore,
    _sessionStore: sessionStore,
    _alarms: alarms,
  };

  return mock;
}

/**
 * Create a browser mock WITHOUT session storage (for testing fallback path).
 */
function createBrowserMockNoSession() {
  const mock = createBrowserMock();
  delete mock.storage.session;
  return mock;
}

/**
 * Install the browser mock on globalThis so IIFE modules can find it.
 */
function installBrowserMock(mock) {
  globalThis.browser = mock;
  return mock;
}

module.exports = { createBrowserMock, createBrowserMockNoSession, installBrowserMock, createEvent };
