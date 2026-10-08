import {
  appendEmptyTableRow,
  byId,
  cssColor,
  fullDate as fullDateLabel,
  integerFormat as numberFormat,
  safeInteger as integer,
  setNotice as setSharedNotice,
  shortDate as dateLabel,
  signedInteger,
} from './dashboard-ui-common.js?v=20261004.1';
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
import { followersReadModel } from './followers-read-model.js?v=20261005.1';

const jstDateTime = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

let currentSource = '';
let requestSequence = 0;
let currentPayload = null;
let chartModel = null;
let selectedIndex = null;
let bound = false;

function followerValue(value) {
  const parsed = integer(value);
  return parsed != null && parsed >= 0 ? parsed : null;
}

function formatFollower(value) {
  const parsed = followerValue(value);
  return parsed == null ? '-' : numberFormat.format(parsed);
}

function formatUpdatedAt(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '-';
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '-' : jstDateTime.format(date);
}

function seriesStyle(account) {
  return {
    color: String(account?.color || '').trim() || '#6f7886',
    dash: Array.isArray(account?.dash) ? account.dash : [],
  };
}

function setChartEmpty(empty) {
  const panel = byId('followersChartPanel');
  const canvas = byId('followersChart');
  const message = byId('followersChartEmpty');
  if (panel) panel.hidden = Boolean(empty);
  if (canvas) canvas.hidden = Boolean(empty);
  if (message) message.hidden = !empty;
  if (empty) {
    chartModel = null;
    selectedIndex = null;
    const detail = byId('followersChartDetail');
    if (detail) detail.textContent = '';
  }
}

function prepareCanvas() {
  const canvas = byId('followersChart');
  if (!canvas) return null;
  const measured = Math.max(320, Math.round(canvas.getBoundingClientRect().width || canvas.clientWidth || 960));
  const height = measured < 520 ? 330 : Math.max(350, Math.min(430, Math.round(measured * .49)));
  return prepareDashboardCanvas(canvas, {
    minimumWidth: 320,
    minimumHeight: 1,
    fallbackWidth: measured,
    height,
  });
}

function rowValue(row, id) {
  return followerValue(row?.values?.[id]);
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
      const value = rowValue(row, account.id);
      return value == null ? null : `${account.label} ${numberFormat.format(value)}`;
    })
    .filter(Boolean);
  detail.textContent = `${fullDateLabel(row.date)}${values.length ? `　${values.join('　')}` : ''}`;
}

function renderLegend(accounts) {
  const legend = byId('followersLegend');
  if (!legend) return;
  legend.replaceChildren();
  accounts.forEach((account) => {
    const item = document.createElement('span');
    item.className = 'followers-legend-item';
    const swatch = document.createElement('i');
    const style = seriesStyle(account);
    swatch.className = 'followers-legend-swatch';
    swatch.style.borderTopColor = style.color;
    swatch.style.borderTopStyle = style.dash.length ? 'dashed' : 'solid';
    swatch.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    copy.className = 'followers-legend-copy';
    const label = document.createElement('strong');
    label.textContent = account.label || account.id;
    const value = document.createElement('span');
    value.textContent = formatFollower(account.value);
    copy.append(label, value);
    item.append(swatch, copy);
    legend.append(item);
  });
}

function renderChart(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const accounts = Array.isArray(payload?.accounts) ? payload.accounts : [];
  const values = rows.flatMap((row) => accounts
    .map((account) => rowValue(row, account.id))
    .filter((value) => value != null));
  if (payload?.chart_enabled === false || rows.length < 2 || !accounts.length || !values.length) {
    setChartEmpty(true);
    return;
  }

  setChartEmpty(false);
  renderLegend(accounts);
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
    context.fillText(numberFormat.format(Math.round(bounds.maximum - bounds.range * ratio)), area.left - 6, y);
  }

  drawDashboardXAxis(context, {
    left: area.left,
    right: area.right,
    top: area.top + area.height,
    width,
    positions,
    indexes: dashboardTickIndexes(rows.length, Math.max(4, Math.floor(area.width / 140))),
    labelFor: (index) => dateLabel(rows[index].date),
    fillStyle: cssColor('--muted', '#667287'),
  });

  accounts.forEach((account) => {
    const style = seriesStyle(account);
    drawDashboardLine(context, rows, {
      x: (_row, index) => positions[index],
      y: (value) => yFor(value),
      value: (row) => rowValue(row, account.id),
      valid: (value) => value != null,
      strokeStyle: style.color,
      lineWidth: 2,
      lineDash: style.dash,
    });
    const latestIndex = rows.findLastIndex((row) => rowValue(row, account.id) != null);
    if (latestIndex < 0) return;
    context.save();
    context.fillStyle = style.color;
    context.beginPath();
    context.arc(positions[latestIndex], yFor(rowValue(rows[latestIndex], account.id)), 3, 0, Math.PI * 2);
    context.fill();
    context.restore();
  });

  context.fillStyle = cssColor('--muted', '#667287');
  context.font = '11px system-ui';
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.fillText(String(payload?.metric_label || 'フォロワー数'), 4, 12);
  context.textAlign = 'center';
  context.fillText('日付', width / 2, height - 2);

  chartModel = { rows, accounts, positions };
  renderChartDetail();
}

function renderTable(payload) {
  const head = byId('followersThead');
  const body = byId('followersTbody');
  if (!head || !body) return;
  const labels = Array.isArray(payload?.columns) && payload.columns.length === 5
    ? payload.columns
    : ['対象', '所属', 'フォロワー数', '前日比', '1週間前比'];
  const tr = document.createElement('tr');
  labels.forEach((label, index) => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    if (index >= 2) th.className = 'followers-number';
    tr.append(th);
  });
  head.replaceChildren(tr);
  body.replaceChildren();
  const accounts = Array.isArray(payload?.accounts) ? payload.accounts : [];
  for (const account of accounts) {
    appendTableRow(body, [
      account.label || account.id || '-',
      { text: account.affiliation || '-', className: 'followers-affiliation' },
      formatFollower(account.value),
      {
        text: signedInteger(account.day_delta),
        className: integer(account.day_delta) > 0 ? 'followers-delta-positive' : '',
      },
      {
        text: signedInteger(account.week_delta),
        className: integer(account.week_delta) > 0 ? 'followers-delta-positive' : '',
      },
    ]);
  }
  if (!accounts.length) appendEmptyTableRow(body, 'フォロワーデータはありません。', 5);
}

function render(payload) {
  const updated = byId('followersUpdatedAt');
  const cadence = byId('followersCadence');
  const chartTitle = byId('followersChartTitle');
  const tableTitle = byId('followersTableTitle');
  const chart = byId('followersChart');
  if (updated) updated.textContent = formatUpdatedAt(payload?.updated_at);
  if (cadence) cadence.textContent = String(payload?.cadence || '-');
  if (chartTitle) chartTitle.textContent = String(payload?.chart_title || 'フォロワー数推移');
  if (tableTitle) tableTitle.textContent = String(payload?.table_title || '最新フォロワー比較');
  if (chart) chart.setAttribute('aria-label', String(payload?.chart_title || 'フォロワー数推移'));
  setSharedNotice('followersNotice', String(payload?.notice || ''), false);
  renderLegend(Array.isArray(payload?.accounts) ? payload.accounts : []);
  renderChart(payload);
  renderTable(payload);
}

function bindInteractions() {
  if (bound) return;
  bound = true;
  const chart = byId('followersChart');
  chart?.addEventListener('pointerup', (event) => {
    if (!chartModel?.positions?.length) return;
    const bounds = chart.getBoundingClientRect();
    if (!bounds.width) return;
    selectedIndex = nearestPositionIndex(chartModel.positions, event.clientX - bounds.left);
    renderChartDetail();
  });
  observeDashboardChartResize(chart, () => {
    if (currentPayload) renderChart(currentPayload);
  }, { delay: 180, enabled: () => Boolean(currentPayload?.chart_enabled) });
}

export async function loadFollowersView({ source = 'stationhead', force = false } = {}) {
  const sequence = ++requestSequence;
  currentSource = source;
  bindInteractions();
  try {
    const payload = await followersReadModel(source).load({ force });
    if (sequence !== requestSequence || currentSource !== source) return payload;
    currentPayload = payload;
    selectedIndex = null;
    render(payload);
    return payload;
  } catch (error) {
    if (sequence === requestSequence && currentSource === source) {
      currentPayload = null;
      setSharedNotice('followersNotice', 'フォロワーデータの取得に失敗しました。', true);
      setChartEmpty(true);
      renderTable({ accounts: [] });
    }
    throw error;
  }
}
