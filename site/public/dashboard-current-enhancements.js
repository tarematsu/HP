const DAY_MS = 86_400_000;
const STATIONHEAD_BUDDIES_URL = 'https://stationhead.com/c/buddies';
const integer = new Intl.NumberFormat('ja-JP');
const jstGoalDateTime = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const jstChartDateTime = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
});
const jstExtremaTime = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
let lastRows = [];
let lastChartModel = null;
let lastGoalPayload = null;
let redrawTimer = 0;

const byId = (id) => document.getElementById(id);
const finite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const numberText = (value) => finite(value) == null ? '—' : integer.format(Number(value));
const thousandText = (value) => {
  const number = finite(value);
  return number == null ? '—' : `${integer.format(Math.round(number / 1000))}K`;
};

function commentVelocity(row) {
  for (const candidate of [row?.comment_velocity, row?.comment_velocity_max, row?.comment_count_delta]) {
    const value = finite(candidate);
    if (value != null) return Math.max(0, value);
  }
  return 0;
}

function normalizeHistory(rows) {
  const cutoff = Date.now() - DAY_MS;
  const byTime = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const observedAt = finite(row?.observed_at);
    if (observedAt == null || observedAt < cutoff) continue;
    byTime.set(observedAt, {
      observed_at: observedAt,
      online_member_count: finite(row.online_member_count),
      comment_velocity: commentVelocity(row),
    });
  }
  return [...byTime.values()].sort((a, b) => a.observed_at - b.observed_at);
}

function ensureMetricLayout() {
  const metrics = document.querySelector('#currentView .metrics');
  if (!metrics) return;
  const onlinePanel = byId('online')?.closest('.metric');
  const streamsPanel = byId('totalStreams')?.closest('.metric');
  const membersPanel = byId('members')?.closest('.metric');
  for (const panel of [onlinePanel, streamsPanel, membersPanel]) {
    if (panel) metrics.append(panel);
  }

  if (onlinePanel && !byId('onlineYesterdayAvg')) {
    const average = document.createElement('div');
    average.id = 'onlineYesterdayAvg';
    average.className = 'delta';
    average.hidden = true;
    onlinePanel.append(average);
  }
  if (membersPanel && !byId('membersThreeDaysAgoDelta')) {
    const delta = document.createElement('div');
    delta.id = 'membersThreeDaysAgoDelta';
    delta.className = 'delta';
    delta.hidden = true;
    membersPanel.append(delta);
  }

  if (streamsPanel && !byId('metricGoalCompact')) {
    const goal = document.createElement('div');
    goal.id = 'metricGoalCompact';
    goal.className = 'metric-goal-compact';
    const row = document.createElement('span');
    row.className = 'metric-goal-row';
    const target = byId('streamGoal') || document.createElement('b');
    target.id = 'streamGoal';
    const eta = byId('goalEta') || document.createElement('strong');
    eta.id = 'goalEta';
    row.append(
      document.createTextNode('目標 '),
      target,
      document.createTextNode(' 予想 '),
      eta,
    );
    goal.append(row);
    streamsPanel.append(goal);
  }
  document.querySelector('.goal-card')?.remove();
}

function goalEtaText(payload) {
  const latest = payload?.latest || {};
  const current = finite(latest.current_stream_count ?? latest.total_stream_count);
  const goal = finite(latest.stream_goal);
  const prediction = payload?.goal_prediction;
  const eta = finite(prediction?.eta);
  if (eta != null && eta > 0 && finite(prediction?.rate_per_hour) > 0) {
    return jstGoalDateTime.format(new Date(eta));
  }
  if (current != null && goal != null && goal > 0 && current >= goal) return '目標達成済み';
  return '予測データ不足';
}

function renderCompactGoal(payload = lastGoalPayload) {
  if (!payload?.ok) return;
  lastGoalPayload = payload;
  ensureMetricLayout();
  const goal = finite(payload?.latest?.stream_goal);
  const goalNode = byId('streamGoal');
  if (goalNode) goalNode.textContent = goal == null || goal <= 0 ? '—' : thousandText(goal);
  const etaNode = byId('goalEta');
  const etaText = goalEtaText(payload);
  if (etaNode && etaNode.textContent !== etaText) etaNode.textContent = etaText;
}

function enforceStationheadLink() {
  const link = byId('nowPlayingLink');
  const hint = byId('spotifyHint');
  if (link) {
    if (link.href !== STATIONHEAD_BUDDIES_URL) link.href = STATIONHEAD_BUDDIES_URL;
    if (link.getAttribute('aria-disabled') !== 'false') link.setAttribute('aria-disabled', 'false');
    if (link.target !== '_blank') link.target = '_blank';
    if (link.rel !== 'noopener noreferrer') link.rel = 'noopener noreferrer';
  }
  if (hint) {
    if (hint.textContent !== 'Stationheadを開く') hint.textContent = 'Stationheadを開く';
    if (hint.hidden) hint.hidden = false;
  }
}

function installPersistentDisplayFixes() {
  ensureMetricLayout();
  enforceStationheadLink();
  const link = byId('nowPlayingLink');
  const hint = byId('spotifyHint');
  if (link) new MutationObserver(enforceStationheadLink).observe(link, {
    attributes: true, attributeFilter: ['href', 'aria-disabled', 'target', 'rel'],
  });
  if (hint) new MutationObserver(enforceStationheadLink).observe(hint, {
    attributes: true, childList: true, subtree: true, characterData: true,
  });
  const eta = byId('goalEta');
  if (eta) new MutationObserver(() => renderCompactGoal()).observe(eta, {
    childList: true, subtree: true, characterData: true,
  });
}

function labelBox(context, text, x, y, align, width, height) {
  context.save();
  context.font = 'bold 10px system-ui';
  const textWidth = context.measureText(text).width;
  const boxWidth = textWidth + 10;
  const boxHeight = 18;
  let left = align === 'right' ? x - boxWidth : x;
  left = Math.max(2, Math.min(width - boxWidth - 2, left));
  const top = Math.max(2, Math.min(height - boxHeight - 2, y - boxHeight / 2));
  context.fillStyle = 'rgba(255,255,255,.92)';
  context.fillRect(left, top, boxWidth, boxHeight);
  context.fillStyle = '#111';
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillText(text, left + 5, top + boxHeight / 2);
  context.restore();
}

function drawEnhancedChart(rows) {
  const canvas = byId('audienceChart');
  if (!canvas || !rows.length) return;
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(300, Math.round(bounds.width || 900));
  const height = width < 520 ? 270 : Math.max(280, Math.min(370, Math.round(width * .42)));
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.height = `${height}px`;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const padding = { left: 50, right: 50, top: 28, bottom: 42 };
  const plotWidth = Math.max(1, width - padding.left - padding.right);
  const plotHeight = Math.max(1, height - padding.top - padding.bottom);
  const times = rows.map((row) => row.observed_at);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const timeSpan = Math.max(1, maxTime - minTime);
  const x = times.map((time) => padding.left + plotWidth * (time - minTime) / timeSpan);

  const onlineValues = rows.map((row) => row.online_member_count).filter((value) => value != null);
  const onlineRawMin = onlineValues.length ? Math.min(...onlineValues) : 0;
  const onlineRawMax = onlineValues.length ? Math.max(...onlineValues) : 1;
  const onlineRawRange = Math.max(1, onlineRawMax - onlineRawMin);
  const onlinePadding = Math.max(1, Math.ceil(onlineRawRange * .08));
  const onlineMin = Math.max(0, onlineRawMin - onlinePadding);
  const onlineMax = onlineRawMax + onlinePadding;
  const onlineRange = Math.max(1, onlineMax - onlineMin);
  const yOnline = (value) => padding.top + plotHeight - (Number(value) - onlineMin) * plotHeight / onlineRange;

  const commentValues = rows.map((row) => commentVelocity(row));
  const commentMax = Math.max(1, ...commentValues);
  const yComment = (value) => padding.top + plotHeight - Number(value) * plotHeight / commentMax;

  context.font = '10px system-ui';
  context.lineWidth = 1;
  for (let index = 0; index <= 4; index += 1) {
    const ratioValue = index / 4;
    const y = padding.top + plotHeight * ratioValue;
    context.strokeStyle = 'rgba(31,45,68,.12)';
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();

    const onlineTick = onlineMax - onlineRange * ratioValue;
    context.fillStyle = '#667287';
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    context.fillText(integer.format(Math.round(onlineTick)), padding.left - 6, y);

    const commentTick = commentMax - commentMax * ratioValue;
    context.textAlign = 'left';
    context.fillText(integer.format(Math.round(commentTick)), width - padding.right + 6, y);
  }

  context.fillStyle = 'rgba(22,139,115,.32)';
  commentValues.forEach((value, index) => {
    if (value <= 0) return;
    const barWidth = Math.max(2, Math.min(5, plotWidth / Math.max(1, rows.length) * .7));
    const barTop = yComment(value);
    context.fillRect(x[index] - barWidth / 2, barTop, barWidth, padding.top + plotHeight - barTop);
  });

  context.beginPath();
  context.strokeStyle = '#111';
  context.lineWidth = 2.5;
  let started = false;
  rows.forEach((row, index) => {
    if (row.online_member_count == null) {
      started = false;
      return;
    }
    const y = yOnline(row.online_member_count);
    if (!started) context.moveTo(x[index], y);
    else context.lineTo(x[index], y);
    started = true;
  });
  context.stroke();

  context.fillStyle = '#667287';
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  for (let index = 0; index < 5; index += 1) {
    const position = Math.round((rows.length - 1) * index / 4);
    context.fillText(
      new Date(rows[position].observed_at).toLocaleTimeString('ja-JP', {
        timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit',
      }),
      x[position],
      height - 14,
    );
  }

  context.font = '10px system-ui';
  context.fillStyle = '#667287';
  context.textAlign = 'left';
  context.fillText('オンライン数(人)', 4, 12);
  context.textAlign = 'right';
  context.fillText('コメント/2分', width - 4, 12);
  context.textAlign = 'center';
  context.fillText('時刻 (JST)', width / 2, height - 2);

  const minIndex = rows.findIndex((row) => row.online_member_count === onlineRawMin);
  const maxIndex = rows.findIndex((row) => row.online_member_count === onlineRawMax);
  if (minIndex >= 0) {
    context.fillStyle = '#111';
    context.beginPath();
    context.arc(x[minIndex], yOnline(onlineRawMin), 3.5, 0, Math.PI * 2);
    context.fill();
    labelBox(
      context,
      `最小 ${numberText(onlineRawMin)}（${jstExtremaTime.format(new Date(rows[minIndex].observed_at))}）`,
      x[minIndex] + 5,
      yOnline(onlineRawMin) + 14,
      'left',
      width,
      height,
    );
  }
  if (maxIndex >= 0) {
    context.fillStyle = '#111';
    context.beginPath();
    context.arc(x[maxIndex], yOnline(onlineRawMax), 3.5, 0, Math.PI * 2);
    context.fill();
    labelBox(
      context,
      `最大 ${numberText(onlineRawMax)}（${jstExtremaTime.format(new Date(rows[maxIndex].observed_at))}）`,
      x[maxIndex] - 5,
      yOnline(onlineRawMax) - 14,
      'right',
      width,
      height,
    );
  }
  lastChartModel = { rows, x };
}

function scheduleDraw() {
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(() => drawEnhancedChart(lastRows), 220);
}

function applyPayload(payload) {
  if (!payload?.ok) return;
  lastRows = normalizeHistory(payload.history);
  renderCompactGoal(payload);
  enforceStationheadLink();
  scheduleDraw();
}

function selectEnhancedPoint(event) {
  if (!lastChartModel?.x?.length) return;
  event.stopImmediatePropagation();
  const bounds = byId('audienceChart')?.getBoundingClientRect();
  if (!bounds) return;
  const pointer = event.clientX - bounds.left;
  let selected = 0;
  let distance = Infinity;
  lastChartModel.x.forEach((point, index) => {
    const next = Math.abs(point - pointer);
    if (next < distance) {
      distance = next;
      selected = index;
    }
  });
  const row = lastChartModel.rows[selected];
  const detail = byId('currentChartDetail');
  if (detail) {
    detail.textContent = `${jstChartDateTime.format(new Date(row.observed_at))} JST　オンライン数 ${numberText(row.online_member_count)}人　コメント勢い ${numberText(commentVelocity(row))}件 / 2分`;
  }
}

installPersistentDisplayFixes();
byId('audienceChart')?.addEventListener('pointerup', selectEnhancedPoint, true);
window.addEventListener('dashboard:payload', (event) => applyPayload(event?.detail?.payload));
window.addEventListener('resize', scheduleDraw, { passive: true });
