function ensureStylesheet() {
  if (document.querySelector('link[data-history-past-toggle-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/history/history-past-toggle.css?v=20260926.1';
  link.dataset.historyPastToggleStyles = '1';
  document.head.append(link);
}

function renameDailyTab() {
  const button = document.querySelector('#modeTabs button[data-mode="daily"]');
  if (button) button.textContent = '過去';
}

function mountPastWeekToggle() {
  const rangePresets = document.getElementById('rangePresets');
  if (!rangePresets || document.getElementById('historyPastWeekToggle')) return;
  const wrap = document.createElement('div');
  wrap.id = 'historyPastWeekToggle';
  wrap.className = 'history-past-week-toggle';
  wrap.hidden = true;
  wrap.innerHTML = `
    <label class="check-label history-past-week-label">
      <input id="historyPastWeekMode" type="checkbox">
      <span>週次</span>
    </label>`;
  rangePresets.append(wrap);
}

ensureStylesheet();
renameDailyTab();
mountPastWeekToggle();
