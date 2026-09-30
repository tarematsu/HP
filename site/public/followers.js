import {
  byId,
  fullDate as fullDateLabel,
  integerFormat as numberFormat,
  safeInteger as integer,
  setNotice as setSharedNotice,
  shortDate as dateLabel,
  svgElement as createSvgNode,
} from './dashboard-ui-common.js?v=20260930.1';

const DEFAULT_HANDLES = Object.freeze([
  'sakuramankai',
  'sakuramankai2',
  'sakurazaka46jp',
  'nogizaka46smej',
]);
let currentPayload = null;
let loadPromise = null;
let resizeObserver = null;

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function normalizedHandle(value) {
  const handle = String(value || '').trim().toLowerCase();
  return handle && handle.length <= 128 ? handle : '';
}

function fixedHandleIndex(handle) {
  const index = DEFAULT_HANDLES.indexOf(handle);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function normalizeHandles(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(normalizedHandle)
    .filter(Boolean))]
    .sort((a, b) => {
      const aFixed = fixedHandleIndex(a);
      const bFixed = fixedHandleIndex(b);
      if (aFixed !== bFixed) return aFixed - bFixed;
      return a.localeCompare(b);
    });
}

function payloadHandles(payload) {
  return normalizeHandles([
    ...DEFAULT_HANDLES,
    ...(Array.isArray(payload?.handles) ? payload.handles : []),
    ...(Array.isArray(payload?.accounts) ? payload.accounts.map((row) => row?.handle) : []),
  ]);
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

function normalizeRows(rows, handles) {
  const byDate = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!validDate(row?.date)) continue;
    const next = { date: row.date };
    let values = 0;
    for (const handle of handles) {
      const value = followerValue(row?.[handle]);
      if (value == null) continue;
      next[handle] = value;
      values += 1;
    }
    if (!values) continue;
    const previous = byDate.get(next.date) || { date: next.date };
    byDate.set(next.date, { ...previous, ...next });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeAccounts(accounts, rows, handles) {
  const provided = new Map((Array.isArray(accounts) ? accounts : [])
    .map((row) => [normalizedHandle(row?.handle), row])
    .filter(([handle]) => handle));
  const latest = rows.at(-1);
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const offsetDate = (days) => {
    if (!latest) return null;
    const time = Date.parse(`${latest.date}T00:00:00Z`) + days * 86_400_000;
    return new Date(time).toISOString().slice(0, 10);
  };
  const previous = latest ? byDate.get(offsetDate(-1)) : null;
  const week = latest ? byDate.get(offsetDate(-7)) : null;
  return handles.map((handle) => {
    const row = provided.get(handle) || {};
    const current = followerValue(row.followers ?? latest?.[handle]);
    const previousValue = followerValue(previous?.[handle]);
    const weekValue = followerValue(week?.[handle]);
    return {
      handle,
      followers: current,
      previous_day_delta: integer(row.previous_day_delta)
        ?? (current != null && previousValue != null ? current - previousValue : null),
      previous_week_delta: integer(row.previous_week_delta)
        ?? (current != null && weekValue != null ? current - weekValue : null),
    };
  });
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

function renderChart(rows, handles) {
  const container = byId('followersChart');
  if (!container) return;
  container.replaceChildren();
  const values = rows.flatMap((row) => handles
    .map((handle) => followerValue(row[handle]))
    .filter((value) => value != null));
  if (!rows.length || !values.length) {
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
    'aria-label': `${handles.length}アカウントのフォロワー数推移`,
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

  handles.forEach((handle, seriesIndex) => {
    const points = rows
      .map((row, index) => ({ row, index, value: followerValue(row[handle]) }))
      .filter(({ value }) => value != null);
    if (!points.length) return;
    const styleIndex = seriesIndex % 4;
    const path = points.map(({ index, value }, pointIndex) => (
      `${pointIndex === 0 ? 'M' : 'L'} ${x(index).toFixed(2)} ${y(value).toFixed(2)}`
    )).join(' ');
    const line = createSvgNode('path', {
      d: path,
      class: `followers-line followers-line-${styleIndex}`,
    });
    const title = createSvgNode('title');
    title.textContent = handle;
    line.append(title);
    svg.append(line);

    const latest = points.at(-1);
    const point = createSvgNode('circle', {
      cx: x(latest.index),
      cy: y(latest.value),
      r: 4,
      class: `followers-endpoint followers-endpoint-${styleIndex}`,
    });
    const pointTitle = createSvgNode('title');
    pointTitle.textContent = `${handle} ${fullDateLabel(latest.row.date)} ${numberFormat.format(latest.value)}`;
    point.append(pointTitle);
    svg.append(point);
  });

  container.append(svg);
}

function renderLegend(accounts) {
  const legend = byId('followersLegend');
  if (!legend) return;
  legend.replaceChildren();
  accounts.forEach((account, index) => {
    const item = document.createElement('div');
    item.className = `followers-legend-item followers-series-${index % 4}`;
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
  const body = byId('followersTbody');
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

const setNotice = (message = '', error = false) => setSharedNotice('followersNotice', message, error);

function render(payload) {
  const handles = payloadHandles(payload);
  const rows = normalizeRows(payload?.rows, handles);
  const accounts = normalizeAccounts(payload?.accounts, rows, handles);
  const latestDate = byId('followersLatestDate');
  if (latestDate) latestDate.textContent = rows.length ? fullDateLabel(rows.at(-1).date) : '-';
  const chart = byId('followersChart');
  if (chart) chart.setAttribute('aria-label', `${handles.length}アカウントのフォロワー数推移`);
  renderLegend(accounts);
  renderChart(rows, handles);
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
        renderChart([], DEFAULT_HANDLES);
        throw error;
      })
      .finally(() => {
        loadPromise = null;
      });
  }
  return loadPromise;
}

if (!resizeObserver && typeof ResizeObserver === 'function') {
  const chart = byId('followersChart');
  if (chart) {
    resizeObserver = new ResizeObserver(() => {
      if (!currentPayload) return;
      const handles = payloadHandles(currentPayload);
      renderChart(normalizeRows(currentPayload.rows, handles), handles);
    });
    resizeObserver.observe(chart);
  }
}
