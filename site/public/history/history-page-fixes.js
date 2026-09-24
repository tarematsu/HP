const visualFixes = document.createElement('style');
visualFixes.textContent = `
  .data-panel { content-visibility: visible !important; contain-intrinsic-size: none !important; }
  .summary-cards strong {
    overflow: visible !important;
    text-overflow: clip !important;
    white-space: normal !important;
    overflow-wrap: anywhere;
    font-size: clamp(1.35rem, 4.8vw, 2.5rem);
  }
`;
document.head.appendChild(visualFixes);

const integer = new Intl.NumberFormat('ja-JP');

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value);
}

function isoDate(value) {
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(String(value || '').trim());
  if (!match) return '';
  return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
}

function mondayOnOrBefore(value) {
  const iso = isoDate(value);
  if (!iso) return '';
  const date = new Date(`${iso}T00:00:00Z`);
  const delta = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - delta);
  return date.toISOString().slice(0, 10);
}

function validRank(value) {
  if (value === null || value === undefined || value === '') return false;
  const rank = Number(value);
  return Number.isFinite(rank) && rank > 0;
}

function rankingWeekCounts(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const singleHost = Array.isArray(payload?.chart_hosts) && payload.chart_hosts.length === 1;
  const sourceWeeks = singleHost
    ? rows.map((row) => row?.ranking_date)
    : Array.isArray(payload?.ranking_weeks) && payload.ranking_weeks.length
      ? payload.ranking_weeks
      : rows.map((row) => row?.ranking_date);
  const weekKeys = new Set(sourceWeeks.map(mondayOnOrBefore).filter(Boolean));
  const totalWeeks = weekKeys.size;
  const rankedWeeks = new Set(rows
    .filter((row) => validRank(row?.rank))
    .map((row) => mondayOnOrBefore(row?.ranking_date))
    .filter((week) => weekKeys.has(week))).size;
  return {
    totalWeeks,
    rankedWeeks,
    outWeeks: Math.max(0, totalWeeks - rankedWeeks),
  };
}

function normalizeRankingWeeklyHeaders() {
  const headers = document.querySelectorAll('#rankingWeeklyThead th');
  for (const header of headers) {
    if (header.textContent.trim() === 'メンバー増加') header.textContent = 'メンバー増加数';
  }
}

function applyAllHostSummary(payload) {
  const summary = payload?.ranking_summary || {};
  setText('periodLabel', '対象週数');
  setText('maxLabel', '掲載ホスト数');
  setText('streamLabel', '延べランクイン数');
  setText('memberLabel', '圏外・欠測数');
  setText('periods', integer.format(Number(summary.week_count || 0)));
  setText('maxListener', integer.format(Number(summary.listed_host_count ?? summary.host_count ?? 0)));
  setText('streamGrowth', integer.format(Number(summary.ranked_entry_count || 0)));
  setText('memberGrowth', integer.format(Number(summary.out_of_rank_count || 0)));
}

function applyHostSummary(payload) {
  const hostCount = Number(payload.host_count || 0);
  const { totalWeeks, rankedWeeks, outWeeks } = rankingWeekCounts(payload);
  setText('periodLabel', '総週数');
  setText('maxLabel', 'ランクイン週数');
  setText('streamLabel', '圏外・欠測週数');
  setText('memberLabel', '対象ホスト');
  setText('periods', integer.format(totalWeeks));
  setText('maxListener', integer.format(rankedWeeks));
  setText('streamGrowth', integer.format(outWeeks));
  setText('memberGrowth', integer.format(hostCount));
}

function applyRankingPresentation(payload) {
  if (!payload || payload.mode !== 'ranking') return;
  const singleSelectedHost = payload.scope === 'all'
    && Array.isArray(payload.chart_hosts)
    && payload.chart_hosts.length === 1;
  if (payload.scope === 'all' && !singleSelectedHost) applyAllHostSummary(payload);
  else applyHostSummary(payload);
  normalizeRankingWeeklyHeaders();
}

window.addEventListener('history:data-loaded', (event) => {
  applyRankingPresentation(event?.detail?.data);
});
