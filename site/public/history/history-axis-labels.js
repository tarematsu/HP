const AXES_BY_MODE = Object.freeze({
  daily: { left: '同接（人）', right: '期間再生数', x: '期間' },
  weekly: { left: '同接（人）', right: '期間再生数', x: '期間' },
  monthly: { left: '同接（人）', right: '期間再生数', x: '期間' },
  ranking: { left: '順位', right: '', x: '週' },
  broadcasts: { left: '同接（人）', right: '', x: '' },
});

function installAxisStyles() {
  if (document.getElementById('historyAxisLabelStyles')) return;
  const style = document.createElement('style');
  style.id = 'historyAxisLabelStyles';
  style.textContent = `
.history-axis-titles {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  min-height: 1em;
  margin: 0 2px 4px;
  color: var(--muted);
  font-size: .66rem;
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
}
.history-axis-titles > :last-child {
  margin-left: auto;
  text-align: right;
}
.history-axis-title-x {
  margin-top: 4px;
  color: var(--muted);
  font-size: .66rem;
  line-height: 1.3;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
#chartPanel .chart-axis {
  display: none !important;
}
@media (max-width: 560px) {
  .history-axis-titles,
  .history-axis-title-x {
    font-size: .62rem;
  }
}`;
  document.head.append(style);
}

function ensureAxisNodes() {
  const canvas = document.getElementById('chart');
  if (!canvas) return;

  let yTitles = document.getElementById('historyChartAxisTitles');
  if (!yTitles) {
    yTitles = document.createElement('div');
    yTitles.id = 'historyChartAxisTitles';
    yTitles.className = 'history-axis-titles';
    yTitles.setAttribute('aria-label', 'グラフ縦軸');
    yTitles.innerHTML = '<span id="chartYAxisLeft"></span><span id="chartYAxisRight"></span>';
    canvas.before(yTitles);
  }

  let xTitle = document.getElementById('chartXAxisTitle');
  if (!xTitle) {
    xTitle = document.createElement('div');
    xTitle.id = 'chartXAxisTitle';
    xTitle.className = 'history-axis-title-x';
    canvas.after(xTitle);
  }

  const endpointAxis = document.querySelector('#chartPanel .chart-axis');
  if (endpointAxis) {
    endpointAxis.hidden = true;
    endpointAxis.setAttribute('aria-hidden', 'true');
  }
}

function setAxisLabel(id, text) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = text;
  node.hidden = !text;
}

function activeHistoryMode() {
  return String(document.querySelector('#modeTabs button.active[data-mode]')?.dataset?.mode || location.hash.slice(1) || 'weekly');
}

export function syncHistoryAxisLabels(mode = activeHistoryMode()) {
  ensureAxisNodes();
  const labels = AXES_BY_MODE[mode] || AXES_BY_MODE.weekly;
  setAxisLabel('chartYAxisLeft', labels.left);
  setAxisLabel('chartYAxisRight', labels.right);
  setAxisLabel('chartXAxisTitle', labels.x);
}

installAxisStyles();
syncHistoryAxisLabels();

window.addEventListener('history:data-loaded', (event) => {
  syncHistoryAxisLabels(String(event?.detail?.mode || activeHistoryMode()));
});
window.addEventListener('hashchange', () => syncHistoryAxisLabels());
