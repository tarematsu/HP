const currentView = document.getElementById('currentView');
const chartCard = currentView?.querySelector('.chart-card');
const primaryGrid = currentView?.querySelector('.primary-grid');

if (chartCard && primaryGrid) {
  const headingBlock = chartCard.querySelector('.chart-head > div:first-child');
  if (headingBlock?.querySelector('h2')) headingBlock.remove();
  primaryGrid.before(chartCard);
}

const likesView = document.getElementById('likesView');
const likeActions = likesView?.querySelector('.like-actions');
if (likesView && likeActions) {
  likeActions.remove();
  for (const id of ['likesLoad', 'likesCsv']) {
    const hook = document.createElement('span');
    hook.id = id;
    hook.hidden = true;
    hook.setAttribute('aria-hidden', 'true');
    likesView.append(hook);
  }
}

const OFFICIAL_EVENT_DATE_GAP = /(\d{4}[./-]\d{1,2}[./-]\d{1,2})[ \u3000]+(?=『)/g;

function normalizeOfficialEventText(root) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    const next = root.nodeValue?.replace(OFFICIAL_EVENT_DATE_GAP, '$1');
    if (next != null && next !== root.nodeValue) root.nodeValue = next;
    return;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const next = node.nodeValue?.replace(OFFICIAL_EVENT_DATE_GAP, '$1');
    if (next != null && next !== node.nodeValue) node.nodeValue = next;
    node = walker.nextNode();
  }
}

const historyView = document.getElementById('historyView');
if (historyView) {
  normalizeOfficialEventText(historyView);
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') normalizeOfficialEventText(mutation.target);
      for (const node of mutation.addedNodes) normalizeOfficialEventText(node);
    }
  }).observe(historyView, { subtree: true, childList: true, characterData: true });
}
