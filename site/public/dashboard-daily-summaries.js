const integer = new Intl.NumberFormat('ja-JP');
const decimal = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 });

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatPeriodLabel(periodKey, fallback) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(periodKey || ''));
  return match ? `${Number(match[2])}月${Number(match[3])}日` : fallback;
}

function ensureNode(id, parentId) {
  let node = document.getElementById(id);
  if (node) return node;
  const parent = document.getElementById(parentId)?.closest('.metric');
  if (!parent) return null;
  node = document.createElement('div');
  node.id = id;
  node.className = 'delta';
  node.hidden = true;
  parent.append(node);
  return node;
}

function renderDelta(id, label, value, parentId) {
  const node = ensureNode(id, parentId);
  if (!node) return;
  const number = finite(value);
  node.className = 'delta';
  node.textContent = number == null
    ? `${label} —`
    : `${label} ${number < 0 ? '−' : '+'}${integer.format(Math.abs(number))}`;
  if (number > 0) node.classList.add('positive');
  if (number < 0) node.classList.add('negative');
  node.hidden = false;
}

function renderOnlineAverage(data) {
  const node = ensureNode('onlineYesterdayAvg', 'online');
  if (!node) return;
  const label = formatPeriodLabel(data?.yesterday?.period_key, '昨日');
  const value = finite(data?.yesterday?.listener_avg);
  node.className = 'delta';
  node.textContent = value == null ? `${label}平均 —` : `${label}平均 ${decimal.format(value)}人`;
  node.hidden = false;
}

export function renderDashboardDailySummaries(data) {
  const yesterdayLabel = formatPeriodLabel(data?.yesterday?.period_key, '昨日');
  const dayBeforeLabel = formatPeriodLabel(data?.day_before_yesterday?.period_key, '一昨日');
  const threeDaysAgoLabel = formatPeriodLabel(data?.three_days_ago?.period_key, '3日前');
  renderOnlineAverage(data);
  renderDelta('membersYesterdayDelta', yesterdayLabel, data?.yesterday?.member_growth, 'members');
  renderDelta('membersDayBeforeDelta', dayBeforeLabel, data?.day_before_yesterday?.member_growth, 'members');
  renderDelta('membersThreeDaysAgoDelta', threeDaysAgoLabel, data?.three_days_ago?.member_growth, 'members');
  renderDelta('streamsYesterdayDelta', yesterdayLabel, data?.yesterday?.stream_growth, 'totalStreams');
  renderDelta('streamsDayBeforeDelta', dayBeforeLabel, data?.day_before_yesterday?.stream_growth, 'totalStreams');
}
