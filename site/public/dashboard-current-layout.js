import { byId, finiteNumber as finite, integerFormat as integer } from './dashboard-ui-common.js?v=20260930.1';

const jstGoalDateTime = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: '2-digit', day: '2-digit',
});

const thousandText = (value) => {
  const number = finite(value);
  return number == null ? '—' : `${integer.format(Math.round(number / 1000))}K`;
};

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

function renderCompactGoal(payload) {
  if (!payload?.ok) return;
  const goal = finite(payload?.latest?.stream_goal);
  const goalNode = byId('streamGoal');
  if (goalNode) goalNode.textContent = goal == null || goal <= 0 ? '—' : thousandText(goal);
  const etaNode = byId('goalEta');
  const etaText = goalEtaText(payload);
  if (etaNode && etaNode.textContent !== etaText) etaNode.textContent = etaText;
}

window.addEventListener('dashboard:payload', (event) => {
  renderCompactGoal(event?.detail?.payload);
});
