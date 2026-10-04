import { stationheadChannelReadModel } from './stationhead-channel-read-model.js?v=20261005.1';

function normalizedMode(value) {
  return value === 'weekly' ? 'weekly' : 'daily';
}

function syncLabels(root, mode) {
  const weekly = mode === 'weekly';
  root.querySelectorAll('[data-history-table-mode]').forEach((button) => {
    const active = button.dataset.historyTableMode === mode;
    button.classList.toggle('is-selected', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  const tableTitle = root.querySelector('[data-role="history-table-title"]');
  if (tableTitle) tableTitle.textContent = weekly ? '週次データ' : '日次データ';
  const panel = root.querySelector('[data-stationhead-panel="history"]');
  const chartTitle = panel?.querySelector('.chart-head h2');
  if (chartTitle) chartTitle.textContent = weekly ? '週次推移' : '日次推移';
  const firstHeader = panel?.querySelector('.data-panel thead th');
  if (firstHeader) firstHeader.textContent = weekly ? '週' : '日付';
  const canvas = panel?.querySelector('[data-role="daily-chart"]');
  if (canvas) canvas.setAttribute('aria-label', `${weekly ? '週次' : '日次'}の同接と再生数増加`);
}

export function bindStationheadHistoryGranularity(root) {
  if (!root || root.dataset.historyGranularityBound === '1') return;
  const buttons = [...root.querySelectorAll('[data-history-table-mode]')];
  if (!buttons.length) return;
  const model = stationheadChannelReadModel(root.dataset.stationheadModel || 'buddies');
  if (typeof model.setHistoryMode !== 'function') return;

  let mode = 'daily';
  const select = (nextMode, reload = true) => {
    mode = normalizedMode(nextMode);
    model.setHistoryMode(mode);
    syncLabels(root, mode);
    if (!reload) return;
    const historyTab = root.querySelector('[data-stationhead-section="history"]');
    if (historyTab && !historyTab.disabled) historyTab.click();
  };

  for (const button of buttons) {
    button.addEventListener('click', () => select(button.dataset.historyTableMode));
  }
  root.querySelector('[data-stationhead-section="history"]')?.addEventListener('click', () => {
    queueMicrotask(() => syncLabels(root, mode));
  });

  root.dataset.historyGranularityBound = '1';
  select('daily', false);
}
