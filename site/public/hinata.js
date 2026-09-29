const HINATA_URL = '/api/hinata';
const SVG_NS = 'http://www.w3.org/2000/svg';
const integer = new Intl.NumberFormat('ja-JP');
const decimal = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 });
const jstTime = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const jstDateTime = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

let payload = null;
let chartRows = [];

const byId = (id) => document.getElementById(id);
const finite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const numberText = (value) => finite(value) == null ? '—' : integer.format(Number(value));
const signedText = (value) => {
  const number = finite(value);
  if (number == null) return '—';
  return `${number >= 0 ? '+' : ''}${integer.format(Math.round(number))}`;
};

function setText(id, value) {
  const node = byId(id);
  if (node) node.textContent = String(value);
}

function svgElement(name, attributes = {}, text = null) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text != null) node.textContent = String(text);
  return node;
}

function renderMetrics(value) {
  const latest = value?.latest || {};
  setText('hinataOnline', numberText(latest.online_member_count));
  setText('hinataStreams', numberText(latest.total_stream_count));
  setText('hinataMembers', numberText(latest.total_member_count));
  const updatedAt = finite(value?.updated_at);
  setText('hinataUpdated', updatedAt == null ? '—' : `${jstTime.format(new Date(updatedAt))} JST`);
}

function normalizedHistory(value) {
  const rows = Array.isArray(value?.history_24h) ? value.history_24h : [];
  return rows.map((row) => ({
    observed_at: finite(row?.observed_at),
    online_member_count: finite(row?.online_member_count),
    stream_delta_5m: finite(row?.stream_delta_5m),
  })).filter((row) => row.observed_at != null)
    .sort((left, right) => left.observed_at - right.observed_at);
}

function renderChart(value) {
  const host = byId('hinataChart');
  if (!host) return;
  chartRows = normalizedHistory(value);
  host.replaceChildren();
  if (!chartRows.length) {
    const empty = document.createElement('p');
    empty.className = 'hinata-empty';
    empty.textContent = 'グラフデータはまだありません。';
    host.append(empty);
    return;
  }

  const width = 1000;
  const height = 320;
  const padding = { left: 58, right: 24, top: 20, bottom: 36 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const minTime = chartRows[0].observed_at;
  const maxTime = chartRows.at(-1).observed_at;
  const span = Math.max(1, maxTime - minTime);
  const onlineMax = Math.max(1, ...chartRows.map((row) => row.online_member_count ?? 0));
  const growthMax = Math.max(1, ...chartRows.map((row) => Math.max(0, row.stream_delta_5m ?? 0)));
  const x = (time) => padding.left + (time - minTime) / span * plotWidth;
  const y = (online) => padding.top + plotHeight - Math.max(0, online || 0) / onlineMax * plotHeight;
  const svg = svgElement('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'presentation',
    preserveAspectRatio: 'none',
  });

  for (let index = 0; index <= 4; index += 1) {
    const ratio = index / 4;
    const gridY = padding.top + plotHeight * ratio;
    svg.append(svgElement('line', {
      x1: padding.left,
      x2: width - padding.right,
      y1: gridY,
      y2: gridY,
      stroke: '#e5e5e5',
      'stroke-width': 1,
    }));
    svg.append(svgElement('text', {
      x: padding.left - 9,
      y: gridY + 4,
      'text-anchor': 'end',
      'font-size': 20,
      fill: '#777',
    }, integer.format(Math.round(onlineMax * (1 - ratio)))));
  }

  const barSlot = Math.max(2, plotWidth / Math.max(1, chartRows.length));
  const barWidth = Math.max(2, Math.min(16, barSlot * 0.72));
  const barMaxHeight = Math.min(92, plotHeight * 0.36);
  for (const row of chartRows) {
    const growth = Math.max(0, row.stream_delta_5m ?? 0);
    if (!growth) continue;
    const barHeight = growth / growthMax * barMaxHeight;
    svg.append(svgElement('rect', {
      x: x(row.observed_at) - barWidth / 2,
      y: padding.top + plotHeight - barHeight,
      width: barWidth,
      height: barHeight,
      fill: '#b9b9b9',
      rx: 1,
    }));
  }

  const onlineRows = chartRows.filter((row) => row.online_member_count != null);
  if (onlineRows.length) {
    const path = onlineRows.map((row, index) => `${index ? 'L' : 'M'} ${x(row.observed_at).toFixed(2)} ${y(row.online_member_count).toFixed(2)}`).join(' ');
    svg.append(svgElement('path', {
      d: path,
      fill: 'none',
      stroke: '#111',
      'stroke-width': 3,
      'vector-effect': 'non-scaling-stroke',
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
    }));
  }

  for (let index = 0; index <= 4; index += 1) {
    const timestamp = minTime + span * index / 4;
    svg.append(svgElement('text', {
      x: padding.left + plotWidth * index / 4,
      y: height - 8,
      'text-anchor': index === 0 ? 'start' : index === 4 ? 'end' : 'middle',
      'font-size': 20,
      fill: '#777',
    }, jstTime.format(new Date(timestamp))));
  }

  const hit = svgElement('rect', {
    x: padding.left,
    y: padding.top,
    width: plotWidth,
    height: plotHeight,
    fill: 'transparent',
  });
  hit.addEventListener('pointerup', (event) => {
    const bounds = svg.getBoundingClientRect();
    if (!bounds.width) return;
    const svgX = (event.clientX - bounds.left) / bounds.width * width;
    const target = minTime + Math.max(0, Math.min(1, (svgX - padding.left) / plotWidth)) * span;
    let selected = chartRows[0];
    for (const row of chartRows) {
      if (Math.abs(row.observed_at - target) < Math.abs(selected.observed_at - target)) selected = row;
    }
    const growth = selected.stream_delta_5m == null ? '—' : `+${decimal.format(selected.stream_delta_5m)}`;
    setText(
      'hinataChartDetail',
      `${jstDateTime.format(new Date(selected.observed_at))} JST　オンライン ${numberText(selected.online_member_count)}人　再生増加 ${growth}/5分`,
    );
  });
  svg.append(hit);
  host.append(svg);
}

function renderDaily(value) {
  const tbody = byId('hinataDailyTbody');
  if (!tbody) return;
  const rows = Array.isArray(value?.daily) ? value.daily : [];
  tbody.replaceChildren();
  if (!rows.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.className = 'hinata-empty';
    cell.textContent = '日次データはまだありません。';
    row.append(cell);
    tbody.append(row);
    return;
  }

  for (const item of rows) {
    const row = document.createElement('tr');
    const values = [
      String(item?.period_key || '—'),
      finite(item?.listener_avg) == null ? '—' : decimal.format(item.listener_avg),
      numberText(item?.listener_min),
      numberText(item?.listener_max),
      signedText(item?.stream_growth),
      signedText(item?.member_growth),
    ];
    for (const valueText of values) {
      const cell = document.createElement('td');
      cell.textContent = valueText;
      row.append(cell);
    }
    tbody.append(row);
  }
}

function render(value) {
  payload = value;
  renderMetrics(value);
  renderChart(value);
  renderDaily(value);
  const notice = byId('hinataNotice');
  if (notice) {
    notice.hidden = true;
    notice.classList.remove('error');
    notice.textContent = '';
  }
}

export async function loadHinataView() {
  const response = await fetch(HINATA_URL, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`hinata API HTTP ${response.status}`);
  const next = await response.json();
  if (!next?.ok) throw new Error(next?.error || 'hinata read model unavailable');
  render(next);
  return next;
}

window.addEventListener('resize', () => {
  if (payload && !byId('hinataView')?.hidden) renderChart(payload);
});
