const baseUrl = 'https://skrzk.pages.dev';

async function load(mode, from, to) {
  const url = `${baseUrl}/api/history?${new URLSearchParams({ mode, from, to, v: String(Date.now()) })}`;
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'cache-control': 'no-cache' },
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  if (!response.ok || payload?.ok !== true) throw new Error(`${mode} ${from}..${to}: HTTP ${response.status}`);
  return payload.rows || [];
}

function select(row) {
  if (!row) return null;
  return {
    period_key: row.period_key,
    period_start: row.period_start,
    period_end: row.period_end,
    sample_count: row.sample_count,
    reliable_sample_count: row.reliable_sample_count,
    listener_avg: row.listener_avg,
    listener_min: row.listener_min,
    listener_max: row.listener_max,
    stream_start: row.stream_start,
    stream_end: row.stream_end,
    stream_growth: row.stream_growth,
    member_start: row.member_start,
    member_end: row.member_end,
    member_growth: row.member_growth,
    quality_score: row.quality_score,
    quality_flags: row.quality_flags,
    period_complete: row.period_complete,
    exclusion_reasons: row.exclusion_reasons,
    live_collector: row.live_collector,
  };
}

function byKey(rows, key) {
  return rows.find((row) => row.period_key === key) || null;
}

const broadDaily = await load('daily', '2024-05-01', '2026-07-29');
const narrowHistorical = await load('daily', '2024-09-01', '2024-10-11');
const narrowMembers = await load('daily', '2025-03-11', '2025-04-16');
const broadWeekly = await load('weekly', '2024-05-01', '2026-07-29');
const narrowWeekly = await load('weekly', '2026-07-13', '2026-07-26');
const narrowRecentDaily = await load('daily', '2026-07-13', '2026-07-26');

console.log('# History broad-vs-narrow comparison');
for (const key of ['2024-09-02', '2024-10-09', '2025-03-11', '2025-04-03', '2025-04-16']) {
  const narrowRows = key < '2025-01-01' ? narrowHistorical : narrowMembers;
  console.log(JSON.stringify({
    key,
    broad: select(byKey(broadDaily, key)),
    narrow: select(byKey(narrowRows, key)),
  }));
}
console.log(JSON.stringify({
  key: '2026-07-20',
  broad_weekly: select(byKey(broadWeekly, '2026-07-20')),
  narrow_weekly: select(byKey(narrowWeekly, '2026-07-20')),
  daily_rows: narrowRecentDaily.map(select),
}));
