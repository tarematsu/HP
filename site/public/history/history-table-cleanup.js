const SUMMARY_MODES = new Set(['daily', 'weekly', 'monthly']);
const SUMMARY_REMOVED_LABELS = new Set(['最大いいね', '主なホスト', '有効記録数', '同接有効数']);
const RANKING_REMOVED_LABELS = new Set(['前週順位', '前週比', 'ランキング種別', '順位データ出典', '品質']);
const RENAMED_LABELS = new Map([
  ['記録数', ['取得記録数', 'その期間に保存された全サンプル数']],
]);
const CACHE_MIGRATION_KEY = 'sh.history.display-cleanup.v3';
const HISTORY_CACHE_PREFIX = 'sh.history.v3:';
let cleaning = false;

function clearStaleHistoryCache() {
  try {
    if (sessionStorage.getItem(CACHE_MIGRATION_KEY) === '1') return;
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(HISTORY_CACHE_PREFIX)) sessionStorage.removeItem(key);
    }
    sessionStorage.setItem(CACHE_MIGRATION_KEY, '1');
  } catch {}
}

function activeMode() {
  return String(document.querySelector('#modeTabs button.active[data-mode]')?.dataset?.mode || '');
}

function removedLabels(mode) {
  if (SUMMARY_MODES.has(mode)) return SUMMARY_REMOVED_LABELS;
  if (mode === 'ranking') return RANKING_REMOVED_LABELS;
  return null;
}

function cleanTable() {
  const mode = activeMode();
  const removedSet = removedLabels(mode);
  const head = document.getElementById('thead');
  const body = document.getElementById('tbody');
  if (!head || !body) return;

  head.closest('table')?.classList.toggle('compact-columns', mode === 'ranking');
  if (cleaning || !removedSet) return;

  const headers = [...head.querySelectorAll('th')];
  if (SUMMARY_MODES.has(mode)) {
    for (const cell of headers) {
      const replacement = RENAMED_LABELS.get(cell.textContent.trim());
      if (!replacement) continue;
      cell.textContent = replacement[0];
      cell.title = replacement[1];
    }
  }
  const removed = headers
    .map((cell, index) => removedSet.has(cell.textContent.trim()) ? index : -1)
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

clearStaleHistoryCache();
const observer = new MutationObserver(cleanTable);
const head = document.getElementById('thead');
const body = document.getElementById('tbody');
if (head) observer.observe(head, { childList: true, subtree: true });
if (body) observer.observe(body, { childList: true, subtree: true });
document.getElementById('modeTabs')?.addEventListener('click', () => queueMicrotask(cleanTable));
queueMicrotask(cleanTable);
