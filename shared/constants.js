'use strict';

window.ShadowLog = window.ShadowLog || {};

window.ShadowLog.Constants = {
  // storage.local keys
  STORAGE_KEY_RULES: 'shadowlog_rules',
  STORAGE_KEY_BUFFER: 'shadowlog_buffer',
  STORAGE_KEY_SETTINGS: 'shadowlog_settings',
  STORAGE_KEY_ACTION_LOG: 'shadowlog_action_log',

  // storage.session keys
  SESSION_KEY_TAB_MAP: 'shadowlog_tab_map',
  SESSION_KEY_PAUSED: 'shadowlog_paused',

  // Buffer limits
  BUFFER_MAX_ENTRIES: 5000,
  BUFFER_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000, // 7 days
  BUFFER_MAX_ATTEMPTS: 10,

  // Safety defaults
  DEFAULT_MAX_DELETES_PER_MINUTE: 60,
  DEFAULT_COOLDOWN_SECONDS: 0,

  // Alarm names
  ALARM_PERIODIC_PREFIX: 'shadowlog_periodic_',
  ALARM_BUFFER_FLUSH: 'shadowlog_buffer_flush',

  // Alarm intervals
  BUFFER_FLUSH_INTERVAL_MINUTES: 5,
  ALARM_MIN_PERIOD_MINUTES: 1,

  // Action log
  ACTION_LOG_MAX_ENTRIES: 200,

  // Deduplication window (ms)
  DEDUP_WINDOW_MS: 2000,

  // Cache clear rate limit (ms)
  CACHE_CLEAR_MIN_INTERVAL_MS: 60000,
};
