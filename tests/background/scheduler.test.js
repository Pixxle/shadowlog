'use strict';

const { createBrowserMock, installBrowserMock } = require('../helpers/browser-mock');
const { loadAllBackgroundModules, ensurePolyfills } = require('../helpers/module-loader');

ensurePolyfills();
installBrowserMock(createBrowserMock());
const SL = loadAllBackgroundModules();
const { Scheduler, RulesEngine, DeletionEngine, Buffer, Constants } = SL;

describe('ShadowLog.Scheduler', () => {
  let bm;

  const STORAGE_KEY_RULES = 'shadowlog_rules';

  function makeRule(overrides = {}) {
    return {
      id: overrides.id || crypto.randomUUID(),
      name: overrides.name || 'Test Rule',
      enabled: overrides.enabled !== undefined ? overrides.enabled : true,
      match: {
        urlRegex: overrides.urlRegex || ['example\\.com'],
        excludeRegex: overrides.excludeRegex || [],
      },
      actions: {
        history: 'delete',
        cookies: 'keep',
        cache: 'keep',
        siteData: 'keep',
        ...(overrides.actions || {}),
      },
      timing: {
        asap: true,
        onTabClose: false,
        onBrowserClose: false,
        periodicMinutes: null,
        ...(overrides.timing || {}),
      },
      safety: {
        maxDeletesPerMinute: 60,
        cooldownSeconds: 0,
        ...(overrides.safety || {}),
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  beforeEach(() => {
    bm = installBrowserMock(createBrowserMock());
  });

  describe('syncAlarms', () => {
    it('should create an alarm for a rule with periodicMinutes', async () => {
      const rule = makeRule({ id: 'r1', name: 'Periodic', timing: { periodicMinutes: 30, asap: false, onTabClose: false, onBrowserClose: false } });
      await Scheduler.syncAlarms([rule]);

      const expectedName = Constants.ALARM_PERIODIC_PREFIX + 'r1';
      expect(bm.alarms.create).toHaveBeenCalledWith(expectedName, {
        delayInMinutes: 30,
        periodInMinutes: 30,
      });
    });

    it('should not create alarms for disabled rules', async () => {
      const rule = makeRule({ enabled: false, timing: { periodicMinutes: 10, asap: false, onTabClose: false, onBrowserClose: false } });
      await Scheduler.syncAlarms([rule]);
      expect(bm.alarms.create).not.toHaveBeenCalled();
    });

    it('should not create alarms for rules without periodicMinutes', async () => {
      const rule = makeRule({ timing: { periodicMinutes: null, asap: true, onTabClose: false, onBrowserClose: false } });
      await Scheduler.syncAlarms([rule]);
      expect(bm.alarms.create).not.toHaveBeenCalled();
    });

    it('should enforce minimum alarm period', async () => {
      const rule = makeRule({ id: 'r1', timing: { periodicMinutes: 0.5, asap: false, onTabClose: false, onBrowserClose: false } });
      await Scheduler.syncAlarms([rule]);

      const expectedName = Constants.ALARM_PERIODIC_PREFIX + 'r1';
      expect(bm.alarms.create).toHaveBeenCalledWith(expectedName, {
        delayInMinutes: Constants.ALARM_MIN_PERIOD_MINUTES,
        periodInMinutes: Constants.ALARM_MIN_PERIOD_MINUTES,
      });
    });

    it('should not recreate an alarm that already exists', async () => {
      const rule = makeRule({ id: 'r1', timing: { periodicMinutes: 15, asap: false, onTabClose: false, onBrowserClose: false } });
      const alarmName = Constants.ALARM_PERIODIC_PREFIX + 'r1';
      bm._alarms[alarmName] = { name: alarmName, periodInMinutes: 15 };

      await Scheduler.syncAlarms([rule]);
      expect(bm.alarms.create).not.toHaveBeenCalled();
    });

    it('should remove orphaned periodic alarms', async () => {
      const orphanName = Constants.ALARM_PERIODIC_PREFIX + 'old-rule-id';
      bm._alarms[orphanName] = { name: orphanName, periodInMinutes: 10 };

      await Scheduler.syncAlarms([]);
      expect(bm.alarms.clear).toHaveBeenCalledWith(orphanName);
    });

    it('should not remove the buffer flush alarm during sync', async () => {
      bm._alarms[Constants.ALARM_BUFFER_FLUSH] = {
        name: Constants.ALARM_BUFFER_FLUSH,
        periodInMinutes: Constants.BUFFER_FLUSH_INTERVAL_MINUTES,
      };

      await Scheduler.syncAlarms([]);
      expect(bm.alarms.clear).not.toHaveBeenCalledWith(Constants.ALARM_BUFFER_FLUSH);
    });

    it('should create alarms for multiple rules with periodic timing', async () => {
      const r1 = makeRule({ id: 'r1', timing: { periodicMinutes: 10, asap: false, onTabClose: false, onBrowserClose: false } });
      const r2 = makeRule({ id: 'r2', timing: { periodicMinutes: 20, asap: false, onTabClose: false, onBrowserClose: false } });
      await Scheduler.syncAlarms([r1, r2]);
      expect(bm.alarms.create).toHaveBeenCalledTimes(2);
    });

    it('should remove orphans but keep current rule alarms', async () => {
      const orphanName = Constants.ALARM_PERIODIC_PREFIX + 'removed';
      const keepName = Constants.ALARM_PERIODIC_PREFIX + 'kept';
      bm._alarms[orphanName] = { name: orphanName, periodInMinutes: 10 };
      bm._alarms[keepName] = { name: keepName, periodInMinutes: 15 };

      const rule = makeRule({ id: 'kept', timing: { periodicMinutes: 15, asap: false, onTabClose: false, onBrowserClose: false } });
      await Scheduler.syncAlarms([rule]);

      expect(bm.alarms.clear).toHaveBeenCalledWith(orphanName);
      expect(bm.alarms.clear).not.toHaveBeenCalledWith(keepName);
    });
  });

  describe('ensureBufferFlushAlarm', () => {
    it('should create the buffer flush alarm when it does not exist', async () => {
      await Scheduler.ensureBufferFlushAlarm();
      expect(bm.alarms.create).toHaveBeenCalledWith(Constants.ALARM_BUFFER_FLUSH, {
        delayInMinutes: Constants.BUFFER_FLUSH_INTERVAL_MINUTES,
        periodInMinutes: Constants.BUFFER_FLUSH_INTERVAL_MINUTES,
      });
    });

    it('should not create the alarm if it already exists', async () => {
      bm._alarms[Constants.ALARM_BUFFER_FLUSH] = {
        name: Constants.ALARM_BUFFER_FLUSH,
        periodInMinutes: Constants.BUFFER_FLUSH_INTERVAL_MINUTES,
      };
      await Scheduler.ensureBufferFlushAlarm();
      expect(bm.alarms.create).not.toHaveBeenCalled();
    });

    it('should use the correct interval from constants', async () => {
      await Scheduler.ensureBufferFlushAlarm();
      const call = bm.alarms.create.mock.calls[0];
      expect(call[1].periodInMinutes).toBe(5);
    });
  });

  describe('handleAlarm', () => {
    describe('buffer flush alarm', () => {
      it('should call Buffer.flush when the buffer flush alarm fires', async () => {
        const flushSpy = jest.spyOn(Buffer, 'flush').mockResolvedValue();
        await Scheduler.handleAlarm({ name: Constants.ALARM_BUFFER_FLUSH });
        expect(flushSpy).toHaveBeenCalledTimes(1);
        flushSpy.mockRestore();
      });
    });

    describe('periodic alarm', () => {
      it('should load rules, scan history, and delete matches', async () => {
        const ruleId = 'periodic-rule';
        const rule = makeRule({ id: ruleId, name: 'Periodic', urlRegex: ['target\\.com'] });
        bm._localStore[STORAGE_KEY_RULES] = [rule];

        bm.history.search.mockResolvedValueOnce([
          { url: 'https://target.com/page1' },
          { url: 'https://safe.com/page2' },
        ]);

        const alarmName = Constants.ALARM_PERIODIC_PREFIX + ruleId;
        await Scheduler.handleAlarm({ name: alarmName });

        expect(bm.history.search).toHaveBeenCalledWith({
          text: '',
          maxResults: 1000,
          startTime: 0,
        });
        expect(bm.history.deleteUrl).toHaveBeenCalledWith({ url: 'https://target.com/page1' });
        expect(bm.history.deleteUrl).not.toHaveBeenCalledWith({ url: 'https://safe.com/page2' });
      });

      it('should clear the alarm if the rule is not found in storage', async () => {
        bm._localStore[STORAGE_KEY_RULES] = [];
        const alarmName = Constants.ALARM_PERIODIC_PREFIX + 'nonexistent';
        await Scheduler.handleAlarm({ name: alarmName });
        expect(bm.alarms.clear).toHaveBeenCalledWith(alarmName);
      });

      it('should clear the alarm if the rule is disabled', async () => {
        const ruleId = 'disabled-rule';
        const rule = makeRule({ id: ruleId, enabled: false });
        bm._localStore[STORAGE_KEY_RULES] = [rule];

        const alarmName = Constants.ALARM_PERIODIC_PREFIX + ruleId;
        await Scheduler.handleAlarm({ name: alarmName });
        expect(bm.alarms.clear).toHaveBeenCalledWith(alarmName);
      });

      it('should reload rules via RulesEngine.loadRules', async () => {
        const ruleId = 'r1';
        const rule = makeRule({ id: ruleId, urlRegex: ['nope\\.com'] });
        bm._localStore[STORAGE_KEY_RULES] = [rule];
        bm.history.search.mockResolvedValueOnce([]);

        const loadSpy = jest.spyOn(RulesEngine, 'loadRules');
        const alarmName = Constants.ALARM_PERIODIC_PREFIX + ruleId;
        await Scheduler.handleAlarm({ name: alarmName });
        expect(loadSpy).toHaveBeenCalled();
        loadSpy.mockRestore();
      });

      it('should handle history.search errors gracefully', async () => {
        const ruleId = 'r1';
        const rule = makeRule({ id: ruleId, urlRegex: ['test\\.com'] });
        bm._localStore[STORAGE_KEY_RULES] = [rule];
        bm.history.search.mockRejectedValueOnce(new Error('history error'));

        const alarmName = Constants.ALARM_PERIODIC_PREFIX + ruleId;
        await expect(Scheduler.handleAlarm({ name: alarmName })).resolves.not.toThrow();
      });

      it('should delete multiple matching history entries in a single sweep', async () => {
        const ruleId = 'r1';
        const rule = makeRule({ id: ruleId, urlRegex: ['target\\.com'] });
        bm._localStore[STORAGE_KEY_RULES] = [rule];

        bm.history.search.mockResolvedValueOnce([
          { url: 'https://target.com/page1' },
          { url: 'https://target.com/page2' },
          { url: 'https://target.com/page3' },
        ]);

        const alarmName = Constants.ALARM_PERIODIC_PREFIX + ruleId;
        await Scheduler.handleAlarm({ name: alarmName });
        expect(bm.history.deleteUrl).toHaveBeenCalledTimes(3);
      });

      it('should use merged actions from evaluateUrl results', async () => {
        const ruleId = 'r1';
        const rule = makeRule({
          id: ruleId,
          urlRegex: ['target\\.com'],
          actions: { history: 'delete', cookies: 'delete', cache: 'keep', siteData: 'keep' },
        });
        bm._localStore[STORAGE_KEY_RULES] = [rule];
        bm.history.search.mockResolvedValueOnce([
          { url: 'https://target.com/page' },
        ]);

        const alarmName = Constants.ALARM_PERIODIC_PREFIX + ruleId;
        await Scheduler.handleAlarm({ name: alarmName });

        expect(bm.browsingData.remove).toHaveBeenCalled();
      });

      it('should only apply the actions of the rule tied to the alarm', async () => {
        const periodicRuleId = 'periodic-only-history';
        const periodicRule = makeRule({
          id: periodicRuleId,
          name: 'Periodic History Only',
          urlRegex: ['target\\.com'],
          actions: { history: 'delete', cookies: 'keep', cache: 'keep', siteData: 'keep' },
          timing: { asap: false, onTabClose: false, onBrowserClose: false, periodicMinutes: 10 },
        });
        const otherRule = makeRule({
          id: 'other-rule',
          name: 'Other Rule',
          urlRegex: ['target\\.com'],
          actions: { history: 'keep', cookies: 'delete', cache: 'keep', siteData: 'keep' },
          timing: { asap: true, onTabClose: false, onBrowserClose: false, periodicMinutes: null },
        });
        bm._localStore[STORAGE_KEY_RULES] = [periodicRule, otherRule];

        bm.history.search.mockResolvedValueOnce([
          { url: 'https://target.com/page' },
        ]);

        const alarmName = Constants.ALARM_PERIODIC_PREFIX + periodicRuleId;
        await Scheduler.handleAlarm({ name: alarmName });

        expect(bm.history.deleteUrl).toHaveBeenCalledWith({ url: 'https://target.com/page' });
        expect(bm.browsingData.remove).not.toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ cookies: true })
        );
      });

      it('should not delete non-matching history entries during sweep', async () => {
        const ruleId = 'r1';
        const rule = makeRule({ id: ruleId, urlRegex: ['specific\\.com'] });
        bm._localStore[STORAGE_KEY_RULES] = [rule];

        bm.history.search.mockResolvedValueOnce([
          { url: 'https://other.com/page' },
          { url: 'https://another.com/page' },
        ]);

        const alarmName = Constants.ALARM_PERIODIC_PREFIX + ruleId;
        await Scheduler.handleAlarm({ name: alarmName });
        expect(bm.history.deleteUrl).not.toHaveBeenCalled();
      });

      it('should handle empty history results', async () => {
        const ruleId = 'r1';
        const rule = makeRule({ id: ruleId, urlRegex: ['test\\.com'] });
        bm._localStore[STORAGE_KEY_RULES] = [rule];
        bm.history.search.mockResolvedValueOnce([]);

        const alarmName = Constants.ALARM_PERIODIC_PREFIX + ruleId;
        await expect(Scheduler.handleAlarm({ name: alarmName })).resolves.not.toThrow();
        expect(bm.history.deleteUrl).not.toHaveBeenCalled();
      });
    });

    describe('unknown alarm', () => {
      it('should do nothing for an unrecognized alarm name', async () => {
        const flushSpy = jest.spyOn(Buffer, 'flush');
        await Scheduler.handleAlarm({ name: 'some_other_alarm' });
        expect(flushSpy).not.toHaveBeenCalled();
        expect(bm.alarms.clear).not.toHaveBeenCalled();
        flushSpy.mockRestore();
      });

      it('should not call history.search for unknown alarms', async () => {
        await Scheduler.handleAlarm({ name: 'unrelated_alarm_123' });
        expect(bm.history.search).not.toHaveBeenCalled();
      });
    });
  });

  describe('syncAlarms edge cases', () => {
    it('should handle an empty rules array without errors', async () => {
      await expect(Scheduler.syncAlarms([])).resolves.not.toThrow();
      expect(bm.alarms.create).not.toHaveBeenCalled();
    });

    it('should handle mixed enabled and disabled rules with periodic timing', async () => {
      const r1 = makeRule({ id: 'r1', enabled: true, timing: { periodicMinutes: 10, asap: false, onTabClose: false, onBrowserClose: false } });
      const r2 = makeRule({ id: 'r2', enabled: false, timing: { periodicMinutes: 20, asap: false, onTabClose: false, onBrowserClose: false } });
      const r3 = makeRule({ id: 'r3', enabled: true, timing: { periodicMinutes: 30, asap: false, onTabClose: false, onBrowserClose: false } });
      await Scheduler.syncAlarms([r1, r2, r3]);
      expect(bm.alarms.create).toHaveBeenCalledTimes(2);
    });

    it('should handle rules with periodicMinutes but also other timing flags', async () => {
      const rule = makeRule({ id: 'r1', timing: { periodicMinutes: 15, asap: true, onTabClose: true, onBrowserClose: false } });
      await Scheduler.syncAlarms([rule]);
      expect(bm.alarms.create).toHaveBeenCalledTimes(1);
    });

    it('should not remove non-periodic alarms that are not buffer flush', async () => {
      bm._alarms['some_other_extension_alarm'] = { name: 'some_other_extension_alarm' };
      await Scheduler.syncAlarms([]);
      expect(bm.alarms.clear).not.toHaveBeenCalledWith('some_other_extension_alarm');
    });
  });

  describe('ensureBufferFlushAlarm edge cases', () => {
    it('should call browser.alarms.get to check for existing alarm', async () => {
      await Scheduler.ensureBufferFlushAlarm();
      expect(bm.alarms.get).toHaveBeenCalledWith(Constants.ALARM_BUFFER_FLUSH);
    });

    it('should use the ALARM_BUFFER_FLUSH constant as the alarm name', async () => {
      await Scheduler.ensureBufferFlushAlarm();
      expect(bm.alarms.create.mock.calls[0][0]).toBe(Constants.ALARM_BUFFER_FLUSH);
    });
  });
});
