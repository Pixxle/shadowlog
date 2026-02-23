'use strict';

(async () => {
  const btnPause = document.getElementById('btn-pause');
  const pauseIcon = document.getElementById('pause-icon');
  const pauseText = document.getElementById('pause-text');
  const btnForget = document.getElementById('btn-forget');
  const forgetFeedback = document.getElementById('forget-feedback');
  const ruleCountEl = document.getElementById('rule-count');
  const bufferCountEl = document.getElementById('buffer-count');
  const actionLogEl = document.getElementById('action-log');
  const linkOptions = document.getElementById('link-options');

  let isPaused = false;

  // --- Init ---

  async function init() {
    try {
      const status = await browser.runtime.sendMessage({ type: 'GET_STATUS' });
      isPaused = status.paused;
      updatePauseButton();
      ruleCountEl.textContent = `${status.activeRuleCount}/${status.ruleCount}`;
      bufferCountEl.textContent = `${status.bufferStats.pending} pending`;
      if (status.bufferStats.failed > 0) {
        bufferCountEl.textContent += `, ${status.bufferStats.failed} failed`;
      }
    } catch (err) {
      console.error('Failed to get status:', err);
    }

    try {
      const log = await browser.runtime.sendMessage({ type: 'GET_ACTION_LOG', limit: 20 });
      renderActionLog(log);
    } catch (err) {
      console.error('Failed to get action log:', err);
    }
  }

  // --- Pause toggle ---

  function updatePauseButton() {
    if (isPaused) {
      pauseIcon.textContent = '\u25B6'; // play
      pauseText.textContent = 'Resume';
      btnPause.classList.add('paused');
    } else {
      pauseIcon.textContent = '\u23F8'; // pause
      pauseText.textContent = 'Pause';
      btnPause.classList.remove('paused');
    }
  }

  btnPause.addEventListener('click', async () => {
    isPaused = !isPaused;
    await browser.runtime.sendMessage({ type: 'SET_PAUSED', value: isPaused });
    updatePauseButton();
  });

  // --- Forget current tab ---

  btnForget.addEventListener('click', async () => {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) {
        showFeedback('No URL to forget', 'error');
        return;
      }
      if (tab.url.startsWith('about:') || tab.url.startsWith('moz-extension:')) {
        showFeedback('Cannot forget internal pages', 'error');
        return;
      }

      const result = await browser.runtime.sendMessage({ type: 'FORGET_URL', url: tab.url });
      if (result.ok) {
        showFeedback(`Forgot: ${truncateUrl(tab.url)}`, 'success');
        // Refresh the log
        const log = await browser.runtime.sendMessage({ type: 'GET_ACTION_LOG', limit: 20 });
        renderActionLog(log);
      } else {
        showFeedback('Failed to forget page', 'error');
      }
    } catch (err) {
      showFeedback('Error: ' + err.message, 'error');
    }
  });

  // --- Action log ---

  function renderActionLog(entries) {
    if (!entries || entries.length === 0) {
      actionLogEl.innerHTML = '<p class="empty-state">No recent actions</p>';
      return;
    }

    actionLogEl.innerHTML = '';
    for (const entry of entries) {
      const el = document.createElement('div');
      el.className = 'log-entry';

      const urlEl = document.createElement('span');
      urlEl.className = 'log-url';
      urlEl.textContent = truncateUrl(entry.url);

      const metaEl = document.createElement('div');
      metaEl.className = 'log-meta';

      const rulesEl = document.createElement('span');
      rulesEl.className = 'log-rules';
      rulesEl.textContent = entry.ruleNames.join(', ');

      const resultEl = document.createElement('span');
      resultEl.className = 'log-result ' + (entry.result?.success ? 'success' : 'failure');
      resultEl.textContent = entry.result?.success ? 'deleted' : 'failed';

      const timeEl = document.createElement('span');
      timeEl.textContent = formatTime(entry.timestamp);

      metaEl.appendChild(rulesEl);
      metaEl.appendChild(resultEl);
      metaEl.appendChild(timeEl);

      el.appendChild(urlEl);
      el.appendChild(metaEl);
      actionLogEl.appendChild(el);
    }
  }

  // --- Options link ---

  linkOptions.addEventListener('click', (e) => {
    e.preventDefault();
    browser.runtime.openOptionsPage();
    window.close();
  });

  // --- Helpers ---

  function truncateUrl(url, maxLen = 50) {
    if (url.length <= maxLen) return url;
    return url.slice(0, maxLen - 3) + '...';
  }

  function formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;

    if (diffMs < 60000) return 'just now';
    if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function showFeedback(message, type) {
    forgetFeedback.textContent = message;
    forgetFeedback.className = `feedback ${type}`;
    forgetFeedback.classList.remove('hidden');
    setTimeout(() => {
      forgetFeedback.classList.add('hidden');
    }, 3000);
  }

  // --- Go ---
  init();
})();
