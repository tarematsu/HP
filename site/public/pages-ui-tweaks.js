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
function scheduleOfficialEventTextNormalization() {
  if (!historyView) return;
  queueMicrotask(() => normalizeOfficialEventText(historyView));
}

window.addEventListener('history:data-loaded', scheduleOfficialEventTextNormalization);
document.getElementById('more')?.addEventListener('click', scheduleOfficialEventTextNormalization);
scheduleOfficialEventTextNormalization();
