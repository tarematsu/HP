const style = document.createElement('style');
style.dataset.pagesHistoryGlobalFixes = '1';
style.textContent = `
  .dashboard-view .data-panel {
    content-visibility: visible !important;
    contain-intrinsic-size: none !important;
  }
  .likes-view .table-wrap,
  .likes-view table,
  .likes-view thead,
  .likes-view tbody,
  .likes-view tr,
  .likes-view th,
  .likes-view td {
    content-visibility: visible !important;
    contain: none !important;
  }
  .dashboard-view .summary-cards strong {
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: clip !important;
    overflow-wrap: normal !important;
    font-size: clamp(1.15rem, 1.8vw, 1.55rem) !important;
    line-height: 1 !important;
  }
`;
document.head.appendChild(style);

function finiteRank(text) {
  const value = String(text ?? '').trim();
  return value !== '' && /^\d+(?:\.\d+)?$/.test(value);
}

function repairRankingSummary() {
  if (location.hash !== '#ranking') return;
  const body = document.getElementById('tbody');
  if (!body) return;
  const rows = [...body.querySelectorAll('tr')].filter((row) => row.querySelectorAll('td').length >= 3);
  if (!rows.length) return;

  const ranked = rows.filter((row) => finiteRank(row.querySelectorAll('td')[2]?.textContent)).length;
  const outOfRank = rows.length - ranked;
  const hosts = new Set(rows.map((row) => row.querySelectorAll('td')[1]?.textContent?.trim()).filter(Boolean));
  const formatter = new Intl.NumberFormat('ja-JP');
  const labels = [
    ['periodLabel', '順位行'],
    ['maxLabel', '掲載行'],
    ['streamLabel', '圏外行'],
    ['memberLabel', '対象ホスト'],
  ];
  const values = [
    ['periods', rows.length],
    ['maxListener', ranked],
    ['streamGrowth', outOfRank],
    ['memberGrowth', hosts.size],
  ];
  for (const [id, text] of labels) {
    const node = document.getElementById(id);
    if (node) node.textContent = text;
  }
  for (const [id, value] of values) {
    const node = document.getElementById(id);
    if (node) node.textContent = formatter.format(value);
  }
}

let rankingRepairFrame = 0;
function scheduleRankingRepair() {
  cancelAnimationFrame(rankingRepairFrame);
  rankingRepairFrame = requestAnimationFrame(() => {
    rankingRepairFrame = requestAnimationFrame(repairRankingSummary);
  });
}

const rankingBody = document.getElementById('tbody');
if (rankingBody) new MutationObserver(scheduleRankingRepair).observe(rankingBody, { childList: true, subtree: true });
window.addEventListener('hashchange', scheduleRankingRepair);
window.addEventListener('history:runtime-ready', scheduleRankingRepair);
scheduleRankingRepair();
