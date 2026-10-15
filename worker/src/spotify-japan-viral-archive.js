// Discovery dates for the discontinued Japanese Viral 50 source.
// Verify older years early, then sample every four weeks until 2017.
// A successful sample hands over to the regular one-period-at-a-time backfill.
export const VIRAL_ARCHIVE_LANDMARKS = Object.freeze({
  daily: Object.freeze([
    '2026-05-14', '2026-05-13', '2026-02-15',
    '2025-05-14', '2024-05-14', '2023-05-14', '2022-05-14',
    '2021-05-14', '2020-05-14', '2019-05-14', '2018-05-14', '2017-05-14',
  ]),
  weekly: Object.freeze([
    '2026-05-07', '2026-02-12', '2025-05-08', '2024-05-09',
    '2023-05-11', '2022-05-12', '2021-05-13', '2020-08-12',
    '2019-05-09', '2018-05-10', '2017-05-11',
  ]),
});
const DAY_MS = 86_400_000;
function weeksEarlier(date, weeks = 4) {
  return new Date(Date.parse(date + 'T00:00:00Z') - weeks * 7 * DAY_MS).toISOString().slice(0, 10);
}
export function nextViralArchiveProbe(state, period, start = '2017-01-01') {
  if (state?.archive_search_complete || state?.latest_chart_date) return null;
  const landmarks = VIRAL_ARCHIVE_LANDMARKS[period];
  if (!landmarks) return null;
  const index = Math.max(0, Math.floor(Number(state?.archive_probe_index) || 0));
  if (index < landmarks.length) return landmarks[index];
  let cursor = state.archive_scan_cursor || landmarks[0];
  // Do not query the same date a second time after checking the landmark set.
  while (cursor >= start && landmarks.includes(cursor)) cursor = weeksEarlier(cursor);
  return cursor >= start ? cursor : null;
}
export function advanceViralArchiveProbe(state, period, start = '2017-01-01') {
  const date = nextViralArchiveProbe(state, period, start);
  if (!date) return null;
  const index = Math.max(0, Math.floor(Number(state.archive_probe_index) || 0));
  if (index < VIRAL_ARCHIVE_LANDMARKS[period].length) state.archive_probe_index = index + 1;
  else state.archive_scan_cursor = weeksEarlier(date);
  return nextViralArchiveProbe(state, period, start);
}
