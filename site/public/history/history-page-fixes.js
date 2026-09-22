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
const WEEK_MS = 7 * 86400000;

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value);
}

function isoDate(value) {
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(String(value || '').trim());
  if (!match) return '';
  return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
}

function mondayOnOrAfter(value) {
  const iso = isoDate(value);
  if (!iso) return '';
  const date = new Date(`${iso}T00:00:00Z`);
  const delta = (8 - date.getUTCDay()) % 7;
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function mondayOnOrBefore(value) {
  const iso = isoDate(value);
  if (!iso) return '';
  const date = new Date(`${iso}T00:00:00Z`);
  const delta = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - delta);
  return date.toISOString().slice(0, 10);
}

function weeklyRange(from, to) {
  const start = mondayOnOrAfter(from);
  const end = mondayOnOrBefore(to);
  if (!start || !end || start > end) return [];
  const weeks = [];
  for (let ts = Date.parse(`${start}T00:00:00Z`); ts <= Date.parse(`${end}T00:00:00Z`); ts += WEEK_MS) {
    weeks.push(new Date(ts).toISOString().slice(0, 10));
  }
  return weeks;
}

function validRank(value) {
  if (value === null || value === undefined || value === '') return false;
  const rank = Number(value);
  return Number.isFinite(rank) && rank > 0;
}

function rankingWeekCounts(payload, from, to) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const range = weeklyRange(from || payload?.from, to || payload?.to);
  const fallbackWeeks = Array.isArray(payload?.ranking_weeks)
    ? payload.ranking_weeks.map(mondayOnOrBefore).filter(Boolean)
    : rows.map((row) => mondayOnOrBefore(row?.ranking_date)).filter(Boolean);
  const totalWeeks = range.length || new Set(fallbackWeeks).size;
  const rankedWeeks = new Set(rows
    .filter((row) => validRank(row?.rank))
    .map((row) => mondayOnOrBefore(row?.ranking_date))
    .filter(Boolean)).size;
  return {
    totalWeeks,
    rankedWeeks: Math.min(totalWeeks, rankedWeeks),
    outWeeks: Math.max(0, totalWeeks - rankedWeeks),
  };
}

function applyRankingPresentation(payload, from, to) {
  if (!payload || payload.mode !== 'ranking') return;
  const hostCount = Number(payload.host_count || 0);
  const { totalWeeks, rankedWeeks, outWeeks } = rankingWeekCounts(payload, from, to);

  setText('periodLabel', '総週数');
  setText('maxLabel', 'ランクイン週数');
  setText('streamLabel', '圏外週数');
  setText('memberLabel', '対象ホスト');
  setText('periods', integer.format(totalWeeks));
  setText('maxListener', integer.format(rankedWeeks));
  setText('streamGrowth', integer.format(outWeeks));
  setText('memberGrowth', integer.format(hostCount));
}

window.addEventListener('history:data-loaded', (event) => {
  const detail = event?.detail || {};
  applyRankingPresentation(detail.data, detail.from, detail.to);
});
