'use strict';

window.ShadowLog = window.ShadowLog || {};

window.ShadowLog.Buffer = (() => {
  const { Constants } = window.ShadowLog;
  const { Storage } = window.ShadowLog;
  const { DeletionEngine } = window.ShadowLog;

  async function getBuffer() {
    return Storage.getLocal(Constants.STORAGE_KEY_BUFFER, []);
  }

  async function setBuffer(buffer) {
    return Storage.setLocal(Constants.STORAGE_KEY_BUFFER, buffer);
  }

  async function enqueue(entry) {
    const buffer = await getBuffer();

    // Deduplicate: if same URL is already pending, update it
    const existing = buffer.findIndex(e => e.url === entry.url && e.status === 'pending');
    if (existing !== -1) {
      buffer[existing].lastAttemptAt = Date.now();
      buffer[existing].actions = entry.actions;
      await setBuffer(buffer);
      return;
    }

    const bufferEntry = {
      id: crypto.randomUUID(),
      url: entry.url,
      hostname: entry.hostname || DeletionEngine.extractHostname(entry.url),
      actions: entry.actions,
      ruleIdMatched: entry.ruleIdMatched || null,
      firstSeenAt: Date.now(),
      lastAttemptAt: null,
      attempts: 0,
      status: 'pending',
    };

    buffer.push(bufferEntry);

    // Enforce max entries (LRU by firstSeenAt)
    if (buffer.length > Constants.BUFFER_MAX_ENTRIES) {
      buffer.sort((a, b) => a.firstSeenAt - b.firstSeenAt);
      buffer.splice(0, buffer.length - Constants.BUFFER_MAX_ENTRIES);
    }

    await setBuffer(buffer);
  }

  async function dequeueReady() {
    const buffer = await getBuffer();
    const now = Date.now();

    return buffer.filter(entry =>
      entry.status === 'pending' &&
      entry.attempts < Constants.BUFFER_MAX_ATTEMPTS &&
      (entry.lastAttemptAt == null || now - entry.lastAttemptAt > 5000) // 5s min between retries
    );
  }

  async function markSuccess(entryId) {
    const buffer = await getBuffer();
    const idx = buffer.findIndex(e => e.id === entryId);
    if (idx !== -1) {
      buffer.splice(idx, 1);
      await setBuffer(buffer);
    }
  }

  async function markFailed(entryId) {
    const buffer = await getBuffer();
    const entry = buffer.find(e => e.id === entryId);
    if (entry) {
      entry.attempts++;
      entry.lastAttemptAt = Date.now();
      if (entry.attempts >= Constants.BUFFER_MAX_ATTEMPTS) {
        entry.status = 'failed';
      }
      await setBuffer(buffer);
    }
  }

  async function trimExpired() {
    const buffer = await getBuffer();
    const cutoff = Date.now() - Constants.BUFFER_MAX_AGE_MS;
    const trimmed = buffer.filter(e => e.firstSeenAt > cutoff);
    if (trimmed.length !== buffer.length) {
      console.log(`ShadowLog: trimmed ${buffer.length - trimmed.length} expired buffer entries`);
      await setBuffer(trimmed);
    }
  }

  async function flush() {
    const ready = await dequeueReady();
    if (ready.length === 0) return;

    console.log(`ShadowLog: flushing ${ready.length} buffered entries`);

    for (const entry of ready) {
      const result = await DeletionEngine.executeActions(entry.url, entry.actions);
      if (result.success) {
        await markSuccess(entry.id);
      } else {
        await markFailed(entry.id);
      }
    }
  }

  async function getStats() {
    const buffer = await getBuffer();
    return {
      total: buffer.length,
      pending: buffer.filter(e => e.status === 'pending').length,
      failed: buffer.filter(e => e.status === 'failed').length,
    };
  }

  async function clear() {
    await setBuffer([]);
  }

  return { enqueue, dequeueReady, markSuccess, markFailed, trimExpired, flush, getStats, clear };
})();
