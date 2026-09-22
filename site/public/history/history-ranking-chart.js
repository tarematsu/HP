const RANKING_MODE = 'ranking';
const FEATURED_HOSTS = ['sakuramankai', 'sakurazaka46jp'];
const HOST_COLORS = new Map([
  ['sakuramankai', '#000000'],
  ['sakurazaka46jp', '#d93f79'],
]);
const integer = new Intl.NumberFormat('ja-JP');

let rows = [];
let rankingWeeks = [];
let chartHosts = [];
let chartScope = 'featured';
let drawTimer = 0;
let resizeTimer = 0;
let selectedWeekIndex = null;
let chartModel = null;

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hostKey(value) {
  return String(value || '').trim().toLowerCase();
}

function isoDate(value) {
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(String(value || '').trim());
  if (!match) return '';
  return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
}

function activeMode() {
  return String(document.querySelector('#modeTabs button.active[data-mode]')?.dataset?.mode || '');
}

function cssColor(name, fallback) {
  if (!name) return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function scheduleDraw(delay = 0) {
  clearTimeout(drawTimer);
  drawTimer = setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(draw)), delay);
}

function prepareCanvas() {
  const canvas = document.getElementById('chart');
  if (!canvas) return null;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const width = Math.max(320, Math.round(canvas.clientWidth || 960));
  const height = Math.max(260, Math.round(canvas.clientHeight || 360));
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return { canvas, context, width, height };
}

function appendLegend(label, color) {
  const span = document.createElement('span');
  const marker = document.createElement('i');
  marker.style.background = color;
  span.append(marker, document.createTextNode(label));
  return span;
}

function colorForHost(host, index) {
  if (chartHosts.length === 1) return '#000000';
  const preset = HOST_COLORS.get(hostKey(host));
  if (preset) return preset;
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

function tickIndices(length, count) {
  if (length <= 1) return [0];
  const indexes = new Set();
  for (let index = 0; index < count; index += 1) {
    indexes.add(Math.round((length - 1) * index / Math.max(1, count - 1)));
  }
  return [...indexes].sort((a, b) => a - b);
}

function hideChart() {
  const panel = document.getElementById('chartPanel');
  if (panel) panel.hidden = true;
  document.getElementById('chartLegend')?.replaceChildren();
  const detail = document.getElementById('chartDetail');
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

  const panel = document.getElementById('chartPanel');
  if (!panel) return;
  panel.hidden = false;
  const prepared = prepareCanvas();
  if (!prepared) return;
  const { canvas, context, width, height } = prepared;
  const area = { left: 46, right: 18, top: 18, bottom: 55 };
  area.width = Math.max(1, width - area.left - area.right);
  area.height = Math.max(1, height - area.top - area.bottom);
  const positions = model.weeks.map((_, index) => area.left
    + area.width * index / Math.max(1, model.weeks.length - 1));

  const ranks = model.series.flatMap((item) => item.values.filter((value) => value != null && value > 0));
  const maxRank = Math.max(1, ...ranks);
  const yFor = (rank) => area.top + ((Math.max(1, Number(rank)) - 1) / Math.max(1, maxRank - 1)) * area.height;

  context.strokeStyle = 'rgba(31,45,68,.12)';
  context.fillStyle = cssColor('--muted', '#667287');
  context.lineWidth = 1;
  context.font = '10.5px system-ui';
  const tickRanks = [...new Set([1, Math.max(1, Math.round((maxRank + 1) / 2)), maxRank])];
  for (const rank of tickRanks) {
    const y = yFor(rank);
    context.beginPath();
    context.moveTo(area.left, y);
    context.lineTo(width - area.right, y);
    context.stroke();
    context.textAlign = 'right';
    context.fillText(`#${integer.format(rank)}`, area.left - 7, y + 3);
  }

  const colors = model.series.map((item, index) => colorForHost(item.host, index));
  model.series.forEach((item, seriesIndex) => {
    context.save();
    context.strokeStyle = colors[seriesIndex];
    context.fillStyle = colors[seriesIndex];
    context.lineWidth = 2.4;
    context.beginPath();
    let open = false;
    item.values.forEach((rank, index) => {
      if (rank == null || rank <= 0) {
        open = false;
        return;
      }
      const x = positions[index];
      const y = yFor(rank);
      if (!open) context.moveTo(x, y);
      else context.lineTo(x, y);
      open = true;
    });
    context.stroke();
    item.values.forEach((rank, index) => {
      if (rank == null || rank <= 0) return;
      context.beginPath();
      context.arc(positions[index], yFor(rank), 2.5, 0, Math.PI * 2);
      context.fill();
    });
    context.restore();
  });

  context.fillStyle = cssColor('--muted', '#667287');
  context.font = '10px system-ui';
  context.textBaseline = 'top';
  const xTickCount = Math.min(model.weeks.length, width < 520 ? 4 : 6);
  for (const index of tickIndices(model.weeks.length, xTickCount)) {
    const x = positions[index];
    context.beginPath();
    context.strokeStyle = 'rgba(31,45,68,.16)';
    context.moveTo(x, area.top + area.height);
    context.lineTo(x, area.top + area.height + 5);
    context.stroke();
    context.fillStyle = cssColor('--muted', '#667287');
    const first = index === 0;
    const last = index === model.weeks.length - 1;
    context.textAlign = first ? 'left' : last ? 'right' : 'center';
    context.fillText(fullWeek(model.weeks[index]), first ? x + 2 : last ? x - 2 : x, area.top + area.height + 9);
  }

  const title = document.getElementById('chartTitle');
  if (title) title.textContent = chartHosts.length === 1
    ? `${chartHosts[0]} 順位推移`
    : '週間リーダーボード順位';
  const legend = document.getElementById('chartLegend');
  if (legend) legend.replaceChildren(...model.series.map((item, index) => appendLegend(item.host, colors[index])));
  const foot = document.getElementById('chartFoot');
  if (foot) foot.textContent = '順位は上ほど高順位です。';
  const start = document.getElementById('chartStartDate');
  const end = document.getElementById('chartEndDate');
  if (start) start.textContent = model.weeks[0] || '—';
  if (end) end.textContent = model.weeks.at(-1) || '—';
  const detail = document.getElementById('chartDetail');
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
  chartScope = detail.data.scope === 'all' ? 'all' : 'featured';
  chartHosts = Array.isArray(detail.data.chart_hosts)
    ? detail.data.chart_hosts.map((host) => String(host || '').trim()).filter(Boolean)
    : detail.data.scope === 'featured' ? FEATURED_HOSTS : [];
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

document.getElementById('chart')?.addEventListener('pointerup', (event) => {
  if (activeMode() !== RANKING_MODE || !chartModel?.positions?.length) return;
  event.stopImmediatePropagation();
  const bounds = event.currentTarget.getBoundingClientRect();
  const pointer = event.clientX - bounds.left;
  let nearest = 0;
  let distance = Infinity;
  chartModel.positions.forEach((position, index) => {
    const next = Math.abs(position - pointer);
    if (next < distance) {
      distance = next;
      nearest = index;
    }
  });
  selectedWeekIndex = nearest;
  draw();
}, true);

window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (activeMode() === RANKING_MODE && chartHosts.length) draw();
  }, 240);
}, { passive: true });
