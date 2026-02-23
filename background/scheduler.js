'use strict';

window.ShadowLog = window.ShadowLog || {};

window.ShadowLog.Scheduler = (() => {
  const { Constants } = window.ShadowLog;
  const { Storage } = window.ShadowLog;
  const { RulesEngine } = window.ShadowLog;
  const { DeletionEngine } = window.ShadowLog;
  const { Buffer } = window.ShadowLog;

  async function syncAlarms(rules) {
    const existingAlarms = await browser.alarms.getAll();
    const periodicAlarmNames = new Set();

    // Create alarms for rules with periodicMinutes
    for (const rule of rules) {
      if (!rule.enabled || !rule.timing || rule.timing.periodicMinutes == null) continue;

      const alarmName = Constants.ALARM_PERIODIC_PREFIX + rule.id;
      periodicAlarmNames.add(alarmName);

      const existing = existingAlarms.find(a => a.name === alarmName);
      if (!existing) {
        const period = Math.max(Constants.ALARM_MIN_PERIOD_MINUTES, rule.timing.periodicMinutes);
        browser.alarms.create(alarmName, {
          delayInMinutes: period,
          periodInMinutes: period,
        });
        console.log(`ShadowLog: created periodic alarm for rule "${rule.name}" every ${period}min`);
      }
    }

    // Remove orphaned periodic alarms
    for (const alarm of existingAlarms) {
      if (alarm.name.startsWith(Constants.ALARM_PERIODIC_PREFIX) && !periodicAlarmNames.has(alarm.name)) {
        await browser.alarms.clear(alarm.name);
        console.log(`ShadowLog: removed orphaned alarm ${alarm.name}`);
      }
    }
  }

  async function ensureBufferFlushAlarm() {
    const existing = await browser.alarms.get(Constants.ALARM_BUFFER_FLUSH);
    if (!existing) {
      browser.alarms.create(Constants.ALARM_BUFFER_FLUSH, {
        delayInMinutes: Constants.BUFFER_FLUSH_INTERVAL_MINUTES,
        periodInMinutes: Constants.BUFFER_FLUSH_INTERVAL_MINUTES,
      });
      console.log(`ShadowLog: created buffer flush alarm every ${Constants.BUFFER_FLUSH_INTERVAL_MINUTES}min`);
    }
  }

  async function handlePeriodicAlarm(alarmName) {
    const ruleId = alarmName.slice(Constants.ALARM_PERIODIC_PREFIX.length);

    // Get all rules to find the one this alarm is for
    const allRules = await Storage.getLocal(Constants.STORAGE_KEY_RULES, []);
    const rule = allRules.find(r => r.id === ruleId);
    if (!rule || !rule.enabled) {
      await browser.alarms.clear(alarmName);
      return;
    }

    // Reload rules engine to make sure we have latest compiled regexes
    await RulesEngine.loadRules();

    // Scan recent history
    try {
      const historyItems = await browser.history.search({
        text: '',
        maxResults: 1000,
        startTime: 0,
      });

      let deleteCount = 0;
      for (const item of historyItems) {
        const matches = RulesEngine.evaluateUrl(item.url);
        if (matches.length > 0) {
          const mergedActions = RulesEngine.mergeActions(matches);
          const result = await DeletionEngine.executeActions(item.url, mergedActions, {
            historyLogContext: 'periodic',
          });
          if (result.success) deleteCount++;
        }
      }

      if (deleteCount > 0) {
        console.log(`ShadowLog: periodic sweep for rule "${rule.name}" deleted ${deleteCount} entries`);
      }
    } catch (err) {
      console.error(`ShadowLog: periodic sweep error for rule "${rule.name}":`, err);
    }
  }

  async function handleAlarm(alarm) {
    if (alarm.name === Constants.ALARM_BUFFER_FLUSH) {
      await Buffer.flush();
    } else if (alarm.name.startsWith(Constants.ALARM_PERIODIC_PREFIX)) {
      await handlePeriodicAlarm(alarm.name);
    }
  }

  return { syncAlarms, ensureBufferFlushAlarm, handleAlarm };
})();
