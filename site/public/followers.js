import {
  appendEmptyState,
  byId,
  cssColor,
  fullDate as fullDateLabel,
  integerFormat as numberFormat,
  safeInteger as integer,
  setNotice as setSharedNotice,
  shortDate as dateLabel,
  signedInteger,
} from './dashboard-ui-common.js?v=20261001.1';
import {
  dashboardTickIndexes,
  drawDashboardGrid,
  drawDashboardLine,
  drawDashboardXAxis,
  prepareDashboardCanvas,
} from './dashboard-chart-canvas.js?v=20261001.2';
import { appendTableRow } from './dashboard-table-dom.js?v=20261001.1';

const DEFAULT_HANDLES = Object.freeze([
  'sakuramankai',
  'sakuramankai2',
  'sakurazaka46jp',
  'nogizaka46smej',
]);
const SERIES_STYLES = Object.freeze([
  Object.freeze({ color: '#111', dash: [] }),
  Object.freeze({ color: '#555', dash: [10, 6] }),
  Object.freeze({ color: '#777', dash: [2, 5] }),
  Object.freeze({ color: '#999', dash: [14, 4, 3, 4] }),
]);

let currentPayload = null;
let loadPromise = null;
let resizeObserver = null;
let observedCanvasWidth = 0;
let chartModel = null;
let selectedIndex = null;

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

function canvasWidth(canvas) {
  if (!canvas) return 0;
  const width = Math.round(canvas.getBoundingClientRect().width || canvas.clientWidth || 0);
  return Number.isFinite(width) && width > 0 ? width : 0;
}

function prepareCanvas() {
  const canvas = byId('followersChart');
  if (!canvas) return null;
  const measuredWidth = Math.max(320, canvasWidth(canvas) || 960);
  const height = measuredWidth < 520 ? 330 : Math.max(350, Math.min(430, Math.round(measuredWidth * .49)));
  const prepared = prepareDashboardCanvas(canvas, {
    minimumWidth: 320,
    minimumHeight: 1,
    fallbackWidth: measuredWidth,
    height,
  });
  if (prepared) observedCanvasWidth = prepared.width;
  return prepared;
}

function setChartEmpty(empty) {
  const canvas = byId('followersChart');
  let message = byId('followersChartEmpty');
  if (!message && empty && canvas?.parentElement) {
    message = appendEmptyState(canvas.parentElement, '0時の初回収集後にグラフを表示します。', {
      className: 'shared-empty',
      tagName: 'p',
    });
    message.id = 'followersChartEmpty';
  }
  if (canvas) canvas.hidden = Boolean(empty);
  if (message) message.hidden = !empty;
}

function followerBounds(values) {
  if (!values.length) return { minimum: 0, maximum: 1, range: 1 };
  const rawMinimum = Math.min(...values);
  const rawMaximum = Math.max(...values);
  const padding = Math.max(1, Math.ceil((rawMaximum - rawMinimum || 1) * .08));
  const minimum = Math.max(0, rawMinimum - padding);
  const maximum = Math.max(minimum + 1, rawMaximum + padding);
  return { minimum, maximum, range: maximum - minimum };
}

function drawGrid(context, { width, area, bounds }) {
  context.fillStyle = cssColor('--muted', '#667287');
  context.font = '11px system-ui';
  context.textBaseline = 'middle';
  for (const { ratio, y } of drawDashboardGrid(context, {
    left: area.left,
    right: area.right,
    top: area.top,
    height: area.height,
    width,
  })) {
    context.textAlign = 'right';
    context.fillText(
      numberFormat.format(Math.round(bounds.maximum - bounds.range * ratio)),
      area.left - 6,
      y,
    );
  }
}

function drawXAxis(context, { rows, positions, area, width }) {
  const count = Math.max(4, Math.floor(area.width / 140));
  drawDashboardXAxis(context, {
    left: area.left,
    right: area.right,
    top: area.top + area.height,
    width,
    positions,
    indexes: dashboardTickIndexes(rows.length, count),
    labelFor: (index) => dateLabel(rows[index].date),
    fillStyle: cssColor('--muted', '#667287'),
  });
}

function drawSeries(context, { rows, handles, positions, yFor }) {
  handles.forEach((handle, seriesIndex) => {
    const style = SERIES_STYLES[seriesIndex % SERIES_STYLES.length];
    const points = drawDashboardLine(context, rows, {
      x: (_row, index) => positions[index],
      y: (value) => yFor(value),
      value: (row) => followerValue(row[handle]),
      valid: (value) => value != null,
      strokeStyle: style.color,
      lineWidth: 2,
      lineDash: style.dash,
    });
    if (!points) return;
    const latestIndex = rows.findLastIndex((row) => followerValue(row[handle]) != null);
    if (latestIndex < 0) return;
    const value = followerValue(rows[latestIndex][handle]);
    context.save();
    context.fillStyle = style.color;
    context.beginPath();
    context.arc(positions[latestIndex], yFor(value), 3, 0, Math.PI * 2);
    context.fill();
    context.restore();
  });
}

function renderChartDetail() {
  const detail = byId('followersChartDetail');
  if (!detail) return;
  const row = Number.isInteger(selectedIndex) ? chartModel?.rows?.[selectedIndex] : null;
  if (!row) {
    detail.textContent = '';
    return;
  }
  const values = chartModel.handles
    .map((handle) => {
      const value = followerValue(row[handle]);
      return value == null ? null : `${handle} ${numberFormat.format(value)}`;
    })
    .filter(Boolean);
  detail.textContent = `${fullDateLabel(row.date)}${values.length ? `　${values.join('　')}` : ''}`;
}

function renderChart(rows, handles) {
  const values = rows.flatMap((row) => handles
    .map((handle) => followerValue(row[handle]))
    .filter((value) => value != null));
  if (!rows.length || !values.length) {
    setChartEmpty(true);
    chartModel = null;
    selectedIndex = null;
    renderChartDetail();
    return;
  }

  setChartEmpty(false);
  const prepared = prepareCanvas();
  if (!prepared) return;
  const { context, width, height } = prepared;
  const area = { left: 58, right: 24, top: 28, bottom: 42 };
  area.width = Math.max(1, width - area.left - area.right);
  area.height = Math.max(1, height - area.top - area.bottom);
  const bounds = followerBounds(values);
  const step = rows.length <= 1 ? 0 : area.width / (rows.length - 1);
  const positions = rows.map((_, index) => rows.length === 1
    ? area.left + area.width / 2
    : area.left + step * index);
  const yFor = (value) => area.top + area.height * (bounds.maximum - value) / bounds.range;

  drawGrid(context, { width, area, bounds });
  drawXAxis(context, { rows, positions, area, width });
  drawSeries(context, { rows, handles, positions, yFor });

  context.fillStyle = cssColor('--muted', '#667287');
  context.font = '11px system-ui';
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.fillText('フォロワー数', 4, 12);
  context.textAlign = 'center';
  context.fillText('日付', width / 2, height - 2);

  chartModel = { rows, handles, positions };
  renderChartDetail();
}

function renderLegend(accounts) {
  const legend = byId('followersLegend');
  if (!legend) return;
  legend.replaceChildren();
  accounts.forEach((account, index) => {
    const item = document.createElement('span');
    item.className = `followers-legend-item followers-series-${index % SERIES_STYLES.length}`;
    const swatch = document.createElement('i');
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
    appendTableRow(body, [
      account.handle,
      formatFollower(account.followers),
      {
        text: signedInteger(account.previous_day_delta),
        className: integer(account.previous_day_delta) > 0 ? 'followers-delta-positive' : '',
      },
      {
        text: signedInteger(account.previous_week_delta),
        className: integer(account.previous_week_delta) > 0 ? 'followers-delta-positive' : '',
      },
    ]);
  }
}

const setNotice = (message = '', error = false) => setSharedNotice('followersNotice', message, error);

function render(payload) {
  const handles = payloadHandles(payload);
  const rows = normalizeRows(payload?.rows, handles);
  const accounts = normalizeAccounts(payload?.accounts, rows, handles);
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
        setNotice('フォロワーデータの取得に失敗しました。', true);
        renderChart([], DEFAULT_HANDLES);
        throw error;
      })
      .finally(() => {
        loadPromise = null;
      });
  }
  return loadPromise;
}

byId('followersChart')?.addEventListener('pointerup', (event) => {
  if (!chartModel?.positions?.length) return;
  const canvas = byId('followersChart');
  const bounds = canvas?.getBoundingClientRect();
  if (!bounds?.width) return;
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
  selectedIndex = nearest;
  renderChartDetail();
});

if (!resizeObserver && typeof ResizeObserver === 'function') {
  const canvas = byId('followersChart');
  if (canvas) {
    resizeObserver = new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect?.width || canvasWidth(canvas));
      if (!currentPayload || !width || width === observedCanvasWidth) return;
      observedCanvasWidth = width;
      const handles = payloadHandles(currentPayload);
      requestAnimationFrame(() => renderChart(normalizeRows(currentPayload.rows, handles), handles));
    });
    resizeObserver.observe(canvas);
  }
}