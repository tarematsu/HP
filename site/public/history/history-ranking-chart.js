import {
  byId,
  cssColor,
  finiteNumber as finite,
  integerFormat as integer,
} from '../dashboard-ui-common.js?v=20260930.1';
import {
  dashboardTickIndexes,
  drawDashboardGrid,
  drawDashboardLine,
  drawDashboardXAxis,
  prepareDashboardCanvas,
} from '../dashboard-chart-canvas.js?v=20261001.2';
import {
  appendDashboardLegendItem,
  dashboardMissingIndexBands,
  DASHBOARD_MISSING_KEY,
  drawDashboardMissingBands,
  nearestPositionIndex,
  observeDashboardChartResize,
} from '../dashboard-chart-runtime.js?v=20261001.1';

const RANKING_MODE = 'ranking';
const FEATURED_HOSTS = ['sakuramankai', 'sakurazaka46jp', 'nogizaka46smej'];
const MISSING_START = '2026-01-26';
const MISSING_END = '2026-09-14';
const HOST_COLORS = new Map([
  ['sakuramankai', '#000000'],
  ['sakurazaka46jp', '#d93f79'],
  ['nogizaka46smej', '#812990'],
]);

let rows = [];
let rankingWeeks = [];
let chartHosts = [];
let chartScope = 'featured';
let drawTimer = 0;
let selectedWeekIndex = null;
let chartModel = null;

function hostKey(value) {
  return String(value || '').trim().toLowerCase();
}

function isoDate(value) {
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(String(value || '').trim());
  if (!match) return '';
  return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
}

function isMissingWeek(value) {
  const week = isoDate(value);
  return Boolean(week && week >= MISSING_START && week <= MISSING_END);
}

function activeMode() {
  return String(document.querySelector('#modeTabs button.active[data-mode]')?.dataset?.mode || '');
}

function scheduleDraw(delay = 0) {
  clearTimeout(drawTimer);
  drawTimer = setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(draw)), delay);
}

function colorForHost(host, index) {
  if (chartScope !== 'featured') return '#000000';
  const preset = HOST_COLORS.get(hostKey(host));
  if (preset) return preset;
  if (chartHosts.length === 1) return '#000000';
  const fallbacks = ['#667287', '#2776b9', '#168b73', '#c56a18'];
  return fallbacks[index % fallbacks.length];
}

function buildModel() {
  if (!chartHosts.length) return { weeks: [], series: [] };
  const allowed = new Set(chartHosts.map(hostKey));
  const sourceRows = rows.filter((row) => allowed.has(hostKey(row?.host_name)));
  const sourceWeeks = [...new Set(sourceRows.map((row) => isoDate(row?.ranking_date)).filter(Boolean))].sort();
  let weeks = sourceWeeks;
  if (chartScope === 'all' && chartHosts.length === 1 && sourceWeeks.length) {
    const firstWeek = sourceWeeks[0];
    const completeWeeks = rankingWeeks.map(isoDate).filter((week) => week && week >= firstWeek);
    if (completeWeeks.length) weeks = [...new Set([...completeWeeks, ...sourceWeeks])].sort();
  }
  const byHostWeek = new Map();
  for (const row of sourceRows) {
    const week = isoDate(row.ranking_date);
    if (!week) continue;
    byHostWeek.set(`${hostKey(row.host_name)}\u0000${week}`, finite(row.rank));
  }
  const series = chartHosts.map((host) => ({
    host,
    values: weeks.map((week) => byHostWeek.get(`${hostKey(host)}\u0000${week}`) ?? null),
  }));
  return { weeks, series };
}

function fullWeek(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return match ? `${match[1]}/${Number(match[2])}/${Number(match[3])}` : String(value || '');
}

function hideChart() {
  const panel = byId('chartPanel');
  if (panel) panel.hidden = true;
  byId('chartLegend')?.replaceChildren();
  const detail = byId('chartDetail');
  if (detail) detail.textContent = '';
  chartModel = null;
}

function draw() {
  if (activeMode() !== RANKING_MODE) return;
  const model = buildModel();
  if (!chartHosts.length || !model.weeks.length) {
    hideChart();
    return;
  }

  const panel = byId('chartPanel');
  if (!panel) return;
  panel.hidden = false;
  const canvas = byId('chart');
  const prepared = prepareDashboardCanvas(canvas, {
    minimumWidth: 320,
    minimumHeight: 260,
    fallbackWidth: 960,
    fallbackHeight: 360,
  });
  if (!prepared) return;
  const { context, width, height } = prepared;
  const area = { left: 46, right: 18, top: 18, bottom: 55 };
  area.width = Math.max(1, width - area.left - area.right);
  area.height = Math.max(1, height - area.top - area.bottom);
  const positions = model.weeks.map((_, index) => area.left
    + area.width * index / Math.max(1, model.weeks.length - 1));

  const step = positions.length > 1 ? area.width / (positions.length - 1) : area.width;
  const hasMissingBand = drawDashboardMissingBands(
    context,
    dashboardMissingIndexBands(model.weeks, positions, area, {
      isMissing: (week) => isMissingWeek(week),
      step,
    }),
    { top: area.top, height: area.height },
  );
  const ranks = model.series.flatMap((item) => item.values.filter((value) => value != null && value > 0));
  const maxRank = Math.max(1, ...ranks);
  const yFor = (rank) => area.top + ((Math.max(1, Number(rank)) - 1) / Math.max(1, maxRank - 1)) * area.height;

  context.fillStyle = cssColor('--muted', '#667287');
  context.font = '11px system-ui';
  context.textBaseline = 'middle';
  for (const { ratio, y } of drawDashboardGrid(context, {
    left: area.left,
    right: area.right,
    top: area.top,
    height: area.height,
    width,
    ticks: 2,
  })) {
    const rank = Math.max(1, Math.round(1 + (maxRank - 1) * ratio));
    context.textAlign = 'right';
    context.fillText(`#${integer.format(rank)}`, area.left - 7, y + 3);
  }

  const colors = model.series.map((item, index) => colorForHost(item.host, index));
  model.series.forEach((item, seriesIndex) => {
    const values = item.values.map((rank, index) => ({ rank, index }));
    drawDashboardLine(context, values, {
      x: (row) => positions[row.index],
      y: (rank) => yFor(rank),
      value: (row) => row.rank,
      valid: (rank) => rank != null && rank > 0,
      strokeStyle: colors[seriesIndex],
      lineWidth: 2,
    });
    context.save();
    context.fillStyle = colors[seriesIndex];
    values.forEach((row) => {
      if (row.rank == null || row.rank <= 0) return;
      context.beginPath();
      context.arc(positions[row.index], yFor(row.rank), 3, 0, Math.PI * 2);
      context.fill();
    });
    context.restore();
  });

  const xTickCount = Math.min(model.weeks.length, width < 520 ? 4 : 6);
  drawDashboardXAxis(context, {
    left: area.left,
    right: area.right,
    top: area.top + area.height,
    width,
    positions,
    indexes: dashboardTickIndexes(model.weeks.length, xTickCount),
    labelFor: (index) => fullWeek(model.weeks[index]),
    fillStyle: cssColor('--muted', '#667287'),
  });

  const title = byId('chartTitle');
  if (title) title.textContent = chartHosts.length === 1
    ? `${chartHosts[0]} 順位推移`
    : '週間リーダーボード順位';
  const legend = byId('chartLegend');
  if (legend) {
    const items = model.series.map((item, index) => appendDashboardLegendItem(item.host, colors[index]));
    if (hasMissingBand) items.push(appendDashboardLegendItem('欠測', DASHBOARD_MISSING_KEY, { datasetKey: 'rankingMissingLegend' }));
    legend.replaceChildren(...items);
  }
  const foot = byId('chartFoot');
  if (foot) foot.textContent = '順位は上ほど高順位です。灰色は欠測期間です。空白週は圏外です。';
  const start = byId('chartStartDate');
  const end = byId('chartEndDate');
  if (start) start.textContent = model.weeks[0] || '—';
  if (end) end.textContent = model.weeks.at(-1) || '—';
  const detail = byId('chartDetail');
  if (detail) {
    if (Number.isInteger(selectedWeekIndex) && model.weeks[selectedWeekIndex]) {
      const week = model.weeks[selectedWeekIndex];
      detail.textContent = `${week}　${model.series.map((item) => {
        const rank = item.values[selectedWeekIndex];
        return `${item.host} ${rank == null ? '圏外' : `#${integer.format(rank)}`}`;
      }).join('　')}`;
    } else {
      detail.textContent = '';
    }
  }

  chartModel = { positions, weeks: model.weeks };
  canvas.dataset.rankingChart = chartHosts.length === 1 ? 'single-host' : 'featured-hosts';
  window.dispatchEvent(new CustomEvent('history:ranking-chart-drawn', {
    detail: { weeks: model.weeks, hosts: [...chartHosts] },
  }));
}

window.addEventListener('history:data-loaded', (event) => {
  const detail = event?.detail || {};
  if (detail.mode !== RANKING_MODE || !detail.data?.ok || !Array.isArray(detail.data.rows)) return;
  rows = detail.data.rows;
  rankingWeeks = Array.isArray(detail.data.ranking_weeks)
    ? detail.data.ranking_weeks.map(isoDate).filter(Boolean)
    : [];
  const hostSearch = String(detail.data.host_search || '').trim();
  const isDefaultFeatured = detail.data.scope !== 'all' && !hostSearch;
  chartScope = isDefaultFeatured ? 'featured' : 'all';
  const apiChartHosts = Array.isArray(detail.data.chart_hosts)
    ? detail.data.chart_hosts.map((host) => String(host || '').trim()).filter(Boolean)
    : [];
  chartHosts = isDefaultFeatured ? FEATURED_HOSTS : apiChartHosts;
  selectedWeekIndex = null;
  scheduleDraw();
});

window.addEventListener('history:ranking-host-selected', (event) => {
  if (activeMode() !== RANKING_MODE) return;
  const host = String(event?.detail?.host || '').trim();
  if (!host) return;
  chartHosts = [host];
  chartScope = 'all';
  selectedWeekIndex = null;
  scheduleDraw();
});

const rankingChart = byId('chart');
rankingChart?.addEventListener('pointerup', (event) => {
  if (activeMode() !== RANKING_MODE || !chartModel?.positions?.length) return;
  event.stopImmediatePropagation();
  const bounds = event.currentTarget.getBoundingClientRect();
  selectedWeekIndex = nearestPositionIndex(chartModel.positions, event.clientX - bounds.left);
  draw();
}, true);

observeDashboardChartResize(rankingChart, draw, {
  delay: 240,
  enabled: () => activeMode() === RANKING_MODE && chartHosts.length > 0,
});
