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
