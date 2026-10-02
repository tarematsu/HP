(() => {
  'use strict';

  const RANKING_MODE = 'ranking';
  const HIDDEN_WHILE_RANKING = ['controls', 'notice', 'summaryCards', 'csv', 'rankingWeeklyPanel'];
  const jstDateTime = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  function activeMode() {
    return String(document.querySelector('#modeTabs button.active[data-mode]')?.dataset?.mode || '');
  }

  function formatUpdatedAt(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return '-';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '-';
    const parts = Object.fromEntries(jstDateTime.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]));
    if (!parts.month || !parts.day || !parts.hour || !parts.minute) return '-';
    return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
  }

  function syncLayout() {
    const ranking = activeMode() === RANKING_MODE;
    const meta = document.getElementById('rankingCompactMeta');
    if (meta) meta.hidden = !ranking;
    for (const id of HIDDEN_WHILE_RANKING) {
      const node = document.getElementById(id);
      if (node) node.style.display = ranking ? 'none' : '';
    }
  }

  window.addEventListener('history:data-loaded', (event) => {
    const detail = event?.detail || {};
    if (detail.mode === RANKING_MODE) {
      const target = document.getElementById('rankingUpdatedAt');
      if (target) target.textContent = formatUpdatedAt(detail.data?.materialized_at);
    }
    queueMicrotask(syncLayout);
  });

  queueMicrotask(() => {
    const tabs = document.getElementById('modeTabs');
    if (tabs) {
      new MutationObserver(() => queueMicrotask(syncLayout)).observe(tabs, {
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'aria-current'],
        childList: true,
      });
    }
    syncLayout();
  });
})();
