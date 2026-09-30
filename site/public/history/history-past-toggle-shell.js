function mountPastWeekToggle() {
  const csv = document.getElementById('csv');
  if (!csv || document.getElementById('historyPastWeekToggle')) return;
  const sectionHead = csv.closest('.section-head');
  if (!sectionHead) return;

  const wrap = document.createElement('div');
  wrap.id = 'historyPastWeekToggle';
  wrap.className = 'history-past-data-switch';
  wrap.hidden = true;
  wrap.innerHTML = `
    <span id="historyPastDataLabel" class="history-past-data-label">日次データ</span>
    <div class="history-past-data-actions" role="group" aria-label="集計単位">
      <button type="button" class="button primary" data-history-past-mode="daily" aria-pressed="true">日次</button>
      <button type="button" class="button" data-history-past-mode="weekly" aria-pressed="false">週次</button>
    </div>
    <input id="historyPastWeekMode" type="checkbox" hidden aria-hidden="true">`;

  csv.hidden = true;
  csv.setAttribute('aria-hidden', 'true');
  csv.setAttribute('tabindex', '-1');
  csv.replaceWith(wrap);
  wrap.append(csv);

  const checkbox = document.getElementById('historyPastWeekMode');
  const label = document.getElementById('historyPastDataLabel');
  const buttons = [...wrap.querySelectorAll('[data-history-past-mode]')];

  function syncMode(enabled) {
    if (label) label.textContent = enabled ? '週次データ' : '日次データ';
    for (const button of buttons) {
      const selected = (button.dataset.historyPastMode === 'weekly') === enabled;
      button.classList.toggle('primary', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    }
  }

  for (const button of buttons) {
    button.addEventListener('click', () => {
      const enabled = button.dataset.historyPastMode === 'weekly';
      if (checkbox.checked !== enabled) {
        checkbox.checked = enabled;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      }
      syncMode(enabled);
    });
  }

  document.getElementById('modeTabs')?.addEventListener('click', () => {
    queueMicrotask(() => syncMode(Boolean(checkbox.checked)));
  });
  window.addEventListener('history:data-loaded', (event) => {
    const mode = String(event.detail?.mode || '');
    if (mode === 'daily' || mode === 'weekly') syncMode(mode === 'weekly');
  });

  syncMode(Boolean(checkbox.checked));
}

mountPastWeekToggle();
