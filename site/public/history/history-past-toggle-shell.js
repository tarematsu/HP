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

mountPastWeekToggle();
