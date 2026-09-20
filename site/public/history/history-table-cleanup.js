const SUMMARY_MODES = new Set(['daily', 'weekly', 'monthly']);
const REMOVED_LABELS = new Set(['最大いいね', '主なホスト']);
let cleaning = false;

function activeMode() {
  return String(document.querySelector('#modeTabs button.active[data-mode]')?.dataset?.mode || '');
}

function cleanSummaryTable() {
  if (cleaning || !SUMMARY_MODES.has(activeMode())) return;
  const head = document.getElementById('thead');
  const body = document.getElementById('tbody');
  if (!head || !body) return;
  const headers = [...head.querySelectorAll('th')];
  const removed = headers
    .map((cell, index) => REMOVED_LABELS.has(cell.textContent.trim()) ? index : -1)
    .filter((index) => index >= 0)
    .sort((a, b) => b - a);
  if (!removed.length) return;
  cleaning = true;
  try {
    for (const index of removed) {
      head.querySelectorAll('th')[index]?.remove();
      for (const row of body.querySelectorAll('tr')) {
        const cells = row.querySelectorAll('td');
        if (cells.length === 1 && cells[0].colSpan > 1) {
          cells[0].colSpan = Math.max(1, cells[0].colSpan - 1);
        } else {
          cells[index]?.remove();
        }
      }
    }
  } finally {
    cleaning = false;
  }
}

const observer = new MutationObserver(cleanSummaryTable);
const head = document.getElementById('thead');
const body = document.getElementById('tbody');
if (head) observer.observe(head, { childList: true, subtree: true });
if (body) observer.observe(body, { childList: true, subtree: true });
document.getElementById('modeTabs')?.addEventListener('click', () => queueMicrotask(cleanSummaryTable));
queueMicrotask(cleanSummaryTable);
