const VALID_MODES = new Set(['daily', 'weekly', 'ranking', 'monthly', 'tracks', 'broadcasts']);
const requestedMode = location.hash.slice(1);

if (!VALID_MODES.has(requestedMode)) {
  history.replaceState(null, '', '#weekly');
}

const DAY_MS = 86_400_000;
const JST_OFFSET_MS = 9 * 60 * 60_000;
const jstDate = (offsetDays = 0) => new Date(Date.now() + JST_OFFSET_MS + offsetDays * DAY_MS)
  .toISOString().slice(0, 10);
const trackDate = document.getElementById('trackDate');
const trackWeekMode = document.getElementById('trackWeekMode');
if (trackDate && !trackDate.value) trackDate.value = jstDate(-1);
if (trackWeekMode) trackWeekMode.checked = false;

await import('/history/history-request-guard.js');
await import('/history/history-page-fixes.js');
await import('/history/history-lite.js');
window.dispatchEvent(new Event('history:runtime-ready'));
