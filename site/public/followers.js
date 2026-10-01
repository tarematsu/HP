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
import {
  dashboardValueBounds,
  nearestPositionIndex,
  observeDashboardChartResize,
} from './dashboard-chart-runtime.js?v=20261001.1';
import { appendTableRow } from './dashboard-table-dom.js?v=20261001.1';

const DEFAULT_HANDLES = Object.freeze([
  'sakuramankai',
  'sakuramankai2',
  'sakurazaka46jp',
  'nogizaka46smej',
]);
const GROUP_COLORS = Object.freeze({
  sakurazaka46: '#f3a6c8',
  nogizaka46: '#8264b0',
  hinatazaka46: '#9ecff3',
});
const SERIES_DASHES = Object.freeze([
  Object.freeze([]),
  Object.freeze([10, 6]),
  Object.freeze([2, 5]),
  Object.freeze([14, 4, 3, 4]),
]);
const FALLBACK_MEMBERSHIPS = Object.freeze({
  sakuramankai: Object.freeze({ affiliation: 'Buddies', group: 'sakurazaka46' }),
  sakuramankai2: Object.freeze({ affiliation: 'Buddies', group: 'sakurazaka46' }),
  sakurazaka46jp: Object.freeze({ affiliation: '櫻坂46公式', group: 'sakurazaka46' }),
  nogizaka46smej: Object.freeze({ affiliation: '乃木坂46公式', group: 'nogizaka46' }),
});

let currentPayload = null;
let loadPromise = null;
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

function normalizedMembership(value, handle) {
  const fallback = FALLBACK_MEMBERSHIPS[handle] || null;
  const affiliation = String(value?.affiliation || value?.label || fallback?.affiliation || '').trim();
  const group = String(value?.group || fallback?.group || '').trim().toLowerCase();
  if (!affiliation && !group) return { affiliation: '-', group: '' };
  return { affiliation: affiliation || '-', group };
}

function membershipFor(payload, provided, handle) {
  return normalizedMembership(
    payload?.memberships?.[handle]
      || { affiliation: provided?.affiliation, group: provided?.group },
    handle,
  );
}

function seriesStyle(account, index) {
  return {
    color: GROUP_COLORS[account?.group] || '#6f7886',
    dash: SERIES_DASHES[index % SERIES_DASHES.length],
  };
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

function normalizeAccounts(payload, rows, handles) {
  const provided = new Map((Array.isArray(payload?.accounts) ? payload.accounts : [])
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
    const membership = membershipFor(payload, row, handle);
    const current = followerValue(row.followers ?? latest?.[handle]);
    const previousValue = followerValue(previous?.[handle]);
    const weekValue = followerValue(week?.[handle]);
    return {
      handle,
      affiliation: membership.affiliation,
      group: membership.group,
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
  return prepareDashboardCanvas(canvas, {
    minimumWidth: 320,
    minimumHeight: 1,
    fallbackWidth: measuredWidth,
    height,
  });
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

function drawSeries(context, { rows, accounts, positions, yFor }) {
  accounts.forEach((account, seriesIndex) => {
    const style = seriesStyle(account, seriesIndex);
    const points = drawDashboardLine(context, rows, {
      x: (_row, index) => positions[index],
      y: (value) => yFor(value),
      value: (row) => followerValue(row[account.handle]),
      valid: (value) => value != null,
      strokeStyle: style.color,
      lineWidth: 2,
      lineDash: style.dash,
    });
    if (!points) return;
    const latestIndex = rows.findLastIndex((row) => followerValue(row[account.handle]) != null);
    if (latestIndex < 0) return;
    const value = followerValue(rows[latestIndex][account.handle]);
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
  const values = chartModel.accounts
    .map((account) => {
      const value = followerValue(row[account.handle]);
      return value == null ? null : `${account.handle} ${numberFormat.format(value)}`;
    })
    .filter(Boolean);
  detail.textContent = `${fullDateLabel(row.date)}${values.length ? `　${values.join('　')}` : ''}`;
}

function renderChart(rows, accounts) {
  const handles = accounts.map((account) => account.handle);
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
  const bounds = dashboardValueBounds(values, { minimumPadding: 1, paddingRatio: .08 });
  const step = rows.length <= 1 ? 0 : area.width / (rows.length - 1);
  const positions = rows.map((_, index) => rows.length === 1
    ? area.left + area.width / 2
    : area.left + step * index);
  const yFor = (value) => area.top + area.height * (bounds.maximum - value) / bounds.range;

  drawGrid(context, { width, area, bounds });
  drawXAxis(context, { rows, positions, area, width });
  drawSeries(context, { rows, accounts, positions, yFor });

  context.fillStyle = cssColor('--muted', '#667287');
  context.font = '11px system-ui';
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.fillText('フォロワー数', 4, 12);
  context.textAlign = 'center';
  context.fillText('日付', width / 2, height - 2);

  chartModel = { rows, accounts, positions };
  renderChartDetail();
}

function renderLegend(accounts) {
  const legend = byId('followersLegend');
  if (!legend) return;
  legend.replaceChildren();
  accounts.forEach((account, index) => {
    const item = document.createElement('span');
    item.className = 'followers-legend-item';
    const swatch = document.createElement('i');
    const style = seriesStyle(account, index);
    swatch.className = 'followers-legend-swatch';
    swatch.style.borderTopColor = style.color;
    swatch.style.borderTopStyle = style.dash.length ? (index % 2 ? 'dashed' : 'dotted') : 'solid';
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
      { text: account.affiliation, className: 'followers-affiliation' },
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
  const accounts = normalizeAccounts(payload, rows, handles);
  const chart = byId('followersChart');
  if (chart) chart.setAttribute('aria-label', `${handles.length}アカウントのフォロワー数推移`);
  renderLegend(accounts);
  renderChart(rows, accounts);
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
        renderChart([], DEFAULT_HANDLES.map((handle) => ({ handle, ...normalizedMembership(null, handle) })));
        throw error;
      })
      .finally(() => {
        loadPromise = null;
      });
  }
  return loadPromise;
}

const followersChart = byId('followersChart');
followersChart?.addEventListener('pointerup', (event) => {
  if (!chartModel?.positions?.length) return;
  const bounds = followersChart.getBoundingClientRect();
  if (!bounds.width) return;
  selectedIndex = nearestPositionIndex(chartModel.positions, event.clientX - bounds.left);
  renderChartDetail();
});

observeDashboardChartResize(followersChart, () => {
  if (!currentPayload) return;
  const handles = payloadHandles(currentPayload);
  const rows = normalizeRows(currentPayload.rows, handles);
  renderChart(rows, normalizeAccounts(currentPayload, rows, handles));
}, { delay: 180, enabled: () => Boolean(currentPayload) });
