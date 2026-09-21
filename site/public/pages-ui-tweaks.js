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
  const likesLoad = document.getElementById('likesLoad');
  const likesCsv = document.getElementById('likesCsv');

  if (likesLoad) {
    const hook = document.createElement('span');
    hook.id = 'likesLoad';
    hook.hidden = true;
    hook.setAttribute('aria-hidden', 'true');
    likesLoad.replaceWith(hook);
  }

  const likesTablePanel = [...likesView.querySelectorAll('.data-panel')]
    .find((panel) => panel.querySelector('#likesTbody'));
  const likesTableHead = likesTablePanel?.querySelector('.section-head');
  if (likesCsv && likesTableHead) likesTableHead.append(likesCsv);

  if (!likeActions.childElementCount) likeActions.remove();
}

const OFFICIAL_EVENT_DATE_GAP = /(\d{4}[./-]\d{1,2}[./-]\d{1,2})[ \u3000]+(?=『)/g;
const OFFICIAL_PARTY_CACHE_PREFIX = 'sakurazaka46jp:v1:r8:';
const OFFICIAL_PARTY_API_REVISION = '9';
const pagesUiNativeFetch = window.fetch.bind(window);

function officialPartyRequest(input) {
  const raw = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
  if (!raw) return null;
  try {
    const url = new URL(raw, location.href);
    if (url.origin !== location.origin || url.pathname !== '/api/sakurazaka46jp') return null;
    url.searchParams.set('v', OFFICIAL_PARTY_API_REVISION);
    return input instanceof Request ? new Request(url.toString(), input) : url.toString();
  } catch {
    return null;
  }
}

window.fetch = (input, init) => pagesUiNativeFetch(officialPartyRequest(input) || input, init);

function clearOfficialPartyCache() {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(OFFICIAL_PARTY_CACHE_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {}
}

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

clearOfficialPartyCache();

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
