const HANDLES = Object.freeze([
  'sakuramankai',
  'sakuramankai2',
  'sakurazaka46jp',
  'nogizaka46smej',
]);
const SVG_NS = 'http://www.w3.org/2000/svg';
const numberFormat = new Intl.NumberFormat('ja-JP');
let currentPayload = null;
let loadPromise = null;
let resizeObserver = null;

function integer(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function dateLabel(value) {
  if (!validDate(value)) return '-';
  const [, month, day] = value.split('-');
  return `${Number(month)}/${Number(day)}`;
}

function fullDateLabel(value) {
  if (!validDate(value)) return '-';
  const [year, month, day] = value.split('-');
  return `${year}/${Number(month)}/${Number(day)}`;
}

function followerValue(value) {
  const parsed = integer(value);
  return parsed != null && parsed >= 0 ? parsed : null;
}

function formatFollower(value) {
  const parsed = followerValue(value);
  return parsed == null ? '-' : numberFormat.format(parsed);
}

function formatDelta(value) {
  const parsed = integer(value);
  if (parsed == null) return '-';
  return `${parsed > 0 ? '+' : ''}${numberFormat.format(parsed)}`;
}

function normalizeRows(rows) {
  const byDate = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!validDate(row?.date)) continue;
    const next = { date: row.date };
    let valid = true;
    for (const handle of HANDLES) {
      const value = followerValue(row?.[handle]);
      if (value == null) {
        valid = false;
        break;
      }
      next[handle] = value;
    }
    if (valid) byDate.set(next.date, next);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeAccounts(accounts, rows) {
  const provided = new Map((Array.isArray(accounts) ? accounts : []).map((row) => [row?.handle, row]));
  const latest = rows.at(-1);
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const offsetDate = (days) => {
    if (!latest) return null;
    const time = Date.parse(`${latest.date}T00:00:00Z`) + days * 86_400_000;
    return new Date(time).toISOString().slice(0, 10);
  };
  const previous = latest ? byDate.get(offsetDate(-1)) : null;
  const week = latest ? byDate.get(offsetDate(-7)) : null;
  return HANDLES.map((handle) => {
    const row = provided.get(handle) || {};
    const current = followerValue(row.followers ?? latest?.[handle]);
    return {
      handle,
      followers: current,
      previous_day_delta: integer(row.previous_day_delta)
        ?? (latest && previous ? latest[handle] - previous[handle] : null),
      previous_week_delta: integer(row.previous_week_delta)
        ?? (latest && week ? latest[handle] - week[handle] : null),
    };
  });
}

function createSvgNode(name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function appendText(svg, text, x, y, className, anchor = 'start') {
  const node = createSvgNode('text', { x, y, class: className, 'text-anchor': anchor });
  node.textContent = text;
  svg.append(node);
  return node;
}

function tickIndexes(length) {
  if (length <= 1) return [0];
  const count = Math.min(6, length);
  const indexes = new Set([0, length - 1]);
  for (let index = 1; index < count - 1; index += 1) {
    indexes.add(Math.round((length - 1) * index / (count - 1)));
  }
  return [...indexes].sort((a, b) => a - b);
}

function renderChart(rows) {
  const container = document.getElementById('followersChart');
  if (!container) return;
  container.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'followers-empty';
    empty.textContent = '0時の初回収集後にグラフを表示します。';
    container.append(empty);
    return;
  }

  const width = 960;
  const height = 360;
  const padding = { top: 18, right: 24, bottom: 44, left: 76 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const values = rows.flatMap((row) => HANDLES.map((handle) => row[handle]));
  let minimum = Math.min(...values);
  let maximum = Math.max(...values);
  if (minimum === maximum) {
    minimum = Math.max(0, minimum - 1);
    maximum += 1;
  } else {
    const pad = Math.max(1, Math.ceil((maximum - minimum) * 0.06));
    minimum = Math.max(0, minimum - pad);
    maximum += pad;
  }
  const range = maximum - minimum || 1;
  const x = (index) => padding.left + (rows.length === 1 ? plotWidth / 2 : plotWidth * index / (rows.length - 1));
  const y = (value) => padding.top + plotHeight * (maximum - value) / range;

  const svg = createSvgNode('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': '4アカウントのフォロワー数推移',
  });

  for (let index = 0; index <= 4; index += 1) {
    const value = minimum + range * (4 - index) / 4;
    const yy = padding.top + plotHeight * index / 4;
    svg.append(createSvgNode('line', {
      x1: padding.left,
      y1: yy,
      x2: width - padding.right,
      y2: yy,
      class: 'followers-grid-line',
    }));
    appendText(svg, numberFormat.format(Math.round(value)), padding.left - 10, yy + 4, 'followers-axis-label', 'end');
  }

  for (const index of tickIndexes(rows.length)) {
    appendText(svg, dateLabel(rows[index].date), x(index), height - 13, 'followers-axis-label', 'middle');
  }

  HANDLES.forEach((handle, seriesIndex) => {
    const path = rows.map((row, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(2)} ${y(row[handle]).toFixed(2)}`).join(' ');
    const line = createSvgNode('path', {
      d: path,
      class: `followers-line followers-line-${seriesIndex}`,
    });
    const title = createSvgNode('title');
    title.textContent = handle;
    line.append(title);
    svg.append(line);

    const latest = rows.at(-1);
    const point = createSvgNode('circle', {
      cx: x(rows.length - 1),
      cy: y(latest[handle]),
      r: 4,
      class: `followers-endpoint followers-endpoint-${seriesIndex}`,
    });
    const pointTitle = createSvgNode('title');
    pointTitle.textContent = `${handle} ${fullDateLabel(latest.date)} ${numberFormat.format(latest[handle])}`;
    point.append(pointTitle);
    svg.append(point);
  });

  container.append(svg);
}

function renderLegend(accounts) {
  const legend = document.getElementById('followersLegend');
  if (!legend) return;
  legend.replaceChildren();
  accounts.forEach((account, index) => {
    const item = document.createElement('div');
    item.className = `followers-legend-item followers-series-${index}`;
    const swatch = document.createElement('span');
    swatch.className = 'followers-legend-swatch';
    swatch.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    copy.className = 'followers-legend-copy';
    const handle = document.createElement('strong');
    handle.textContent = account.handle;
    const value = document.createElement('span');
    value.textContent = formatFollower(account.followers);
    copy.append(handle, value);
    item.append(swatch, copy);
    legend.append(item);
  });
}

function renderTable(accounts) {
  const body = document.getElementById('followersTbody');
  if (!body) return;
  body.replaceChildren();
  for (const account of accounts) {
    const row = document.createElement('tr');
    const handle = document.createElement('td');
    handle.textContent = account.handle;
    const current = document.createElement('td');
    current.textContent = formatFollower(account.followers);
    const day = document.createElement('td');
    day.textContent = formatDelta(account.previous_day_delta);
    if (integer(account.previous_day_delta) > 0) day.classList.add('followers-delta-positive');
    const week = document.createElement('td');
    week.textContent = formatDelta(account.previous_week_delta);
    if (integer(account.previous_week_delta) > 0) week.classList.add('followers-delta-positive');
    row.append(handle, current, day, week);
    body.append(row);
  }
}

function setNotice(message = '', error = false) {
  const notice = document.getElementById('followersNotice');
  if (!notice) return;
  notice.textContent = message;
  notice.hidden = !message;
  notice.classList.toggle('error', error);
}

function render(payload) {
  const rows = normalizeRows(payload?.rows);
  const accounts = normalizeAccounts(payload?.accounts, rows);
  const latestDate = document.getElementById('followersLatestDate');
  if (latestDate) latestDate.textContent = rows.length ? fullDateLabel(rows.at(-1).date) : '-';
  renderLegend(accounts);
  renderChart(rows);
  renderTable(accounts);
  if (!rows.length) setNotice('フォロワー履歴はまだありません。初回の0時収集後に表示されます。');
  else setNotice('');
}

async function fetchFollowers() {
  const response = await fetch('/api/followers', { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`followers API returned ${response.status}`);
  const payload = await response.json();
  if (!payload?.ok) throw new Error(String(payload?.error || 'followers payload unavailable'));
  return payload;
}

export async function loadFollowersView() {
  if (currentPayload) {
    render(currentPayload);
    return currentPayload;
  }
  if (!loadPromise) {
    loadPromise = fetchFollowers()
      .then((payload) => {
        currentPayload = payload;
        render(payload);
        return payload;
      })
      .catch((error) => {
        setNotice('フォロワーデータを取得できませんでした。', true);
        renderChart([]);
        throw error;
      })
      .finally(() => {
        loadPromise = null;
      });
  }
  return loadPromise;
}

if (!resizeObserver && typeof ResizeObserver === 'function') {
  const chart = document.getElementById('followersChart');
  if (chart) {
    resizeObserver = new ResizeObserver(() => {
      if (currentPayload) renderChart(normalizeRows(currentPayload.rows));
    });
    resizeObserver.observe(chart);
  }
}
