import { utcDate } from './history-date-utils.js';

const VALID_MODES = new Set(['daily', 'weekly', 'ranking', 'monthly', 'tracks', 'broadcasts']);
const requestedMode = location.hash.slice(1);

if (!VALID_MODES.has(requestedMode)) {
  history.replaceState(null, '', '#weekly');
}

const trackDate = document.getElementById('trackDate');
const trackWeekMode = document.getElementById('trackWeekMode');
if (trackDate && !trackDate.value) trackDate.value = utcDate(-1);
if (trackWeekMode) trackWeekMode.checked = false;

await import('/history/history-request-guard.js');
await import('/history/history-page-fixes.js');
await import('/history/history-lite.js');
window.dispatchEvent(new Event('history:runtime-ready'));
