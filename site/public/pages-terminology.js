function setMetricLabel(valueId, label) {
  const panel = document.getElementById(valueId)?.closest('.metric');
  const node = panel?.querySelector(':scope > span');
  if (node && node.textContent !== label) node.textContent = label;
}

function setSummaryLabel(valueId, label) {
  const article = document.getElementById(valueId)?.closest('article');
  const node = article?.querySelector(':scope > span');
  if (node && node.textContent !== label) node.textContent = label;
}

function replaceExact(root, selector, replacements) {
  if (!root) return;
  for (const node of root.querySelectorAll(selector)) {
    const current = node.textContent.trim();
    const next = replacements.get(current);
    if (next && next !== current) node.textContent = next;
  }
}

function applyTerminology() {
  setMetricLabel('totalStreams', '累計再生数');

  const memberLabel = document.getElementById('memberLabel');
  if (memberLabel?.textContent.trim() === 'メンバー増加') memberLabel.textContent = 'メンバー増加数';

  setSummaryLabel('likesTrackCount', '対象楽曲数');
  setSummaryLabel('likesMaxLikes', '最大いいね数');
  setSummaryLabel('likesLatestAt', '最終取得');

  const likesView = document.getElementById('likesView');
  replaceExact(likesView, 'h2', new Map([
    ['曲別一覧', '楽曲別一覧'],
  ]));
  replaceExact(likesView, 'th', new Map([
    ['最新いいね', '最新いいね数'],
    ['最終観測', '最終取得'],
  ]));

  const historyView = document.getElementById('historyView');
  replaceExact(historyView, 'th', new Map([
    ['品質', 'データ品質'],
  ]));

  const broadcastsTab = document.querySelector('#modeTabs [data-mode="broadcasts"]');
  if (broadcastsTab && broadcastsTab.textContent !== '公式リスパ') broadcastsTab.textContent = '公式リスパ';
}

applyTerminology();
window.addEventListener('history:data-loaded', applyTerminology);
window.addEventListener('history:runtime-ready', applyTerminology);
