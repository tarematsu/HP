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

function setOnlineLabels() {
  const panel = document.getElementById('online')?.closest('.metric');
  const label = panel?.querySelector(':scope > span');
  if (label) label.textContent = 'オンライン数';
  const legend = document.querySelector('#currentView .legend .online-key');
  if (legend) legend.textContent = 'オンライン数';
}

function removeOnlineRange() {
  document.getElementById('online24h')?.remove();
}

function renderOnlineAverage(id, summary, fallback) {
  const node = ensureNode(id, 'online');
  if (!node) return;
  const label = formatPeriodLabel(summary?.period_key, fallback);
  const value = finite(summary?.listener_avg);
  node.className = 'delta';
  node.textContent = value == null ? `${label}平均 —` : `${label}平均 ${decimal.format(value)}`;
  node.hidden = false;
}

export function renderDashboardDailySummaries(data) {
  const yesterdayLabel = formatPeriodLabel(data?.yesterday?.period_key, '昨日');
  const dayBeforeLabel = formatPeriodLabel(data?.day_before_yesterday?.period_key, '一昨日');
  const threeDaysAgoLabel = formatPeriodLabel(data?.three_days_ago?.period_key, '3日前');
  setOnlineLabels();
  removeOnlineRange();
  renderOnlineAverage('onlineYesterdayAvg', data?.yesterday, '昨日');
  renderOnlineAverage('onlineDayBeforeAvg', data?.day_before_yesterday, '2日前');
  renderOnlineAverage('onlineThreeDaysAgoAvg', data?.three_days_ago, '3日前');
  renderDelta('membersYesterdayDelta', yesterdayLabel, data?.yesterday?.member_growth, 'members');
  renderDelta('membersDayBeforeDelta', dayBeforeLabel, data?.day_before_yesterday?.member_growth, 'members');
  renderDelta('membersThreeDaysAgoDelta', threeDaysAgoLabel, data?.three_days_ago?.member_growth, 'members');
  renderDelta('streamsYesterdayDelta', yesterdayLabel, data?.yesterday?.stream_growth, 'totalStreams');
  renderDelta('streamsDayBeforeDelta', dayBeforeLabel, data?.day_before_yesterday?.stream_growth, 'totalStreams');
}

if (typeof document !== 'undefined') {
  setOnlineLabels();
  removeOnlineRange();
}

if (typeof window !== 'undefined') {
  window.addEventListener('dashboard:payload', (event) => {
    renderDashboardDailySummaries(event?.detail?.payload?.daily_summaries);
  });
}
