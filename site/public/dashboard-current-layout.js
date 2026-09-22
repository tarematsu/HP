const STATIONHEAD_BUDDIES_URL = 'https://stationhead.com/c/buddies';
const integer = new Intl.NumberFormat('ja-JP');
const jstGoalDateTime = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: '2-digit', day: '2-digit',
});
let lastGoalPayload = null;

const byId = (id) => document.getElementById(id);
const finite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const thousandText = (value) => {
  const number = finite(value);
  return number == null ? '—' : `${integer.format(Math.round(number / 1000))}K`;
};

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

installPersistentDisplayFixes();
window.addEventListener('dashboard:payload', (event) => {
  const payload = event?.detail?.payload;
  if (!payload?.ok) return;
  renderCompactGoal(payload);
  enforceStationheadLink();
});
