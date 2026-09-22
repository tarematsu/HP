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

function applyRankingPresentation(payload) {
  if (!payload || payload.mode !== 'ranking') return;
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const rankedCount = rows.filter((row) => Number.isFinite(Number(row?.rank))).length;
  const outCount = rows.length - rankedCount;
  const hostCount = Number(payload.host_count || 0);

  setText('maxLabel', '掲載行');
  setText('streamLabel', '圏外行');
  setText('memberLabel', '対象ホスト');
  setText('maxListener', integer.format(rankedCount));
  setText('streamGrowth', integer.format(outCount));
  setText('memberGrowth', integer.format(hostCount));
}

window.addEventListener('history:data-loaded', (event) => {
  applyRankingPresentation(event?.detail?.data);
});
