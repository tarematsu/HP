(() => {
  'use strict';

  let rankingMode = location.hash === '#ranking';

  const byId = (id) => document.getElementById(id);

  function setRankingMode(enabled) {
    rankingMode = Boolean(enabled);
    const controls = byId('controls');
    if (controls) controls.hidden = rankingMode;
    const rankingControls = byId('rankingControls');
    if (rankingControls) {
      rankingControls.hidden = true;
      rankingControls.style.display = 'none';
    }
  }

  function moveRankNextToWeek() {
    const head = byId('thead')?.querySelector('tr');
    if (!head || head.children.length < 2) return;
    const rankIndex = [...head.children].findIndex((cell) => cell.textContent.trim() === '順位');
    if (rankIndex <= 1) return;
    head.insertBefore(head.children[rankIndex], head.children[1]);

    for (const row of byId('tbody')?.querySelectorAll('tr') || []) {
      if (row.children.length <= rankIndex) continue;
      row.insertBefore(row.children[rankIndex], row.children[1]);
    }
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('#modeTabs button');
    if (!button) return;
    const mode = button.dataset.mode || button.dataset.view || '';
    queueMicrotask(() => setRankingMode(mode === 'ranking'));
  });

  window.addEventListener('popstate', () => {
    queueMicrotask(() => setRankingMode(location.hash === '#ranking'));
  });

  window.addEventListener('history:data-loaded', (event) => {
    const mode = event.detail?.mode || '';
    setRankingMode(mode === 'ranking');
    if (mode === 'ranking') moveRankNextToWeek();
  });

  const controls = byId('controls');
  if (controls) {
    new MutationObserver(() => {
      if (rankingMode && !controls.hidden) controls.hidden = true;
    }).observe(controls, { attributes: true, attributeFilter: ['hidden'] });
  }

  const tableBody = byId('tbody');
  if (tableBody) {
    new MutationObserver(() => {
      if (rankingMode) moveRankNextToWeek();
    }).observe(tableBody, { childList: true });
  }

  setRankingMode(rankingMode);
})();
