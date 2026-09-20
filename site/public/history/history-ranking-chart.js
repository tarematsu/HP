const browser = typeof window === 'undefined' ? null : window;
const previousFetch = browser?.fetch?.bind(browser) || null;
const RANKING_MODE = 'ranking';
const HOSTS = ['sakuramankai', 'sakurazaka46jp'];
const integer = new Intl.NumberFormat('ja-JP');

let rows = [];
let rankingWeeks = [];
let drawTimer = 0;
let resizeTimer = 0;
let selectedWeekIndex = null;
let chartModel = null;

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requestUrl(input) {
  try {
    const value = typeof input === 'string' || input instanceof URL ? input : input?.url;
    return new URL(value, browser?.location?.href || 'https://history.invalid/');
  } catch {
    return null;
  }
}

function activeMode() {
  return String(document.querySelector('#modeTabs button.active[data-mode]')?.dataset?.mode || '');
}

function cssColor(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function scheduleDraw(delay = 0) {
  clearTimeout(drawTimer);
  drawTimer = setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(draw)), delay);
}

async function captureRankingResponse(input, response) {
  if (!response?.ok) return;
  const url = requestUrl(input);
  if (!url || url.origin !== location.origin || url.pathname !== '/api/history') return;
  if (String(url.searchParams.get('mode') || '').toLowerCase() !== RANKING_MODE) return;
  try {
    const data = await response.clone().json();
    if (!data?.ok || !Array.isArray(data.rows)) return;
    rows = data.rows;
    rankingWeeks = Array.isArray(data.ranking_weeks) ? data.ranking_weeks : [];
    selectedWeekIndex = null;
    scheduleDraw();
  } catch {}
}

if (browser && previousFetch) {
  browser.fetch = async (input, init) => {
    const response = await previousFetch(input, init);
    void captureRankingResponse(input, response);
    return response;
  };
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

function buildModel() {
  const featuredRows = rows.filter((row) => HOSTS.includes(String(row?.host_name || '').trim().toLowerCase()));
  const weeks = rankingWeeks.length
    ? [...new Set(rankingWeeks.map(String))].sort()
    : [...new Set(featuredRows.map((row) => String(row.ranking_date || '')).filter(Boolean))].sort();
  const byHostWeek = new Map();
  for (const row of featuredRows) {
    byHostWeek.set(`${String(row.host_name || '').trim().toLowerCase()}\u0000${row.ranking_date}`, finite(row.rank));
  }
  const series = HOSTS.map((host) => ({
    host,
    values: weeks.map((week) => byHostWeek.get(`${host}\u0000${week}`) ?? null),
  }));
  return { weeks, series };
}

function draw() {
  if (activeMode() !== RANKING_MODE) return;
  const model = buildModel();
  if (!model.weeks.length) return;

  const panel = document.getElementById('chartPanel');
  if (!panel) return;
  panel.hidden = false;
  const prepared = prepareCanvas();
  if (!prepared) return;
  const { canvas, context, width, height } = prepared;
  const area = { left: 46, right: 18, top: 18, bottom: 40 };
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

  const colors = [cssColor('--accent', '#d93f79'), cssColor('--blue', '#2776b9')];
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

  const title = document.getElementById('chartTitle');
  if (title) title.textContent = '週間リーダーボード順位';
  const legend = document.getElementById('chartLegend');
  if (legend) legend.replaceChildren(...HOSTS.map((host, index) => appendLegend(host, colors[index])));
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
      const values = model.series.map((item) => item.values[selectedWeekIndex]);
      detail.textContent = `${week}　sakuramankai ${values[0] == null ? '圏外' : `#${integer.format(values[0])}`}`
        + `　sakurazaka46jp ${values[1] == null ? '圏外' : `#${integer.format(values[1])}`}`;
    } else {
      detail.textContent = '';
    }
  }

  chartModel = { positions, weeks: model.weeks };
  canvas.dataset.rankingChart = 'featured-hosts';
}

const tbody = document.getElementById('tbody');
tbody?.addEventListener('DOMNodeInserted', () => scheduleDraw());
if (tbody) new MutationObserver(() => {
  if (activeMode() === RANKING_MODE) scheduleDraw();
}).observe(tbody, { childList: true });

document.getElementById('modeTabs')?.addEventListener('click', () => scheduleDraw(20));

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
    if (activeMode() === RANKING_MODE) draw();
  }, 240);
}, { passive: true });
