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

const historical = await load('daily', '2024-09-01', '2024-10-11');
const memberDates = await load('daily', '2025-03-11', '2025-04-16');
const recentDaily = await load('daily', '2026-07-13', '2026-07-26');
const recentWeekly = await load('weekly', '2026-07-13', '2026-07-26');

console.log('# History mismatch details');
console.log('## Historical arithmetic mismatches');
for (const row of historical) {
  const streamExpected = row.stream_start != null && row.stream_end != null ? Number(row.stream_end) - Number(row.stream_start) : null;
  const memberExpected = row.member_start != null && row.member_end != null ? Number(row.member_end) - Number(row.member_start) : null;
  if ((streamExpected != null && Number(row.stream_growth) !== streamExpected)
      || (memberExpected != null && Number(row.member_growth) !== memberExpected)) {
    console.log(JSON.stringify({ ...select(row), stream_expected: streamExpected, member_expected: memberExpected }));
  }
}
for (const row of memberDates) {
  const memberExpected = row.member_start != null && row.member_end != null ? Number(row.member_end) - Number(row.member_start) : null;
  if (memberExpected != null && Number(row.member_growth) !== memberExpected) {
    console.log(JSON.stringify({ ...select(row), member_expected: memberExpected }));
  }
}

console.log('## Recent daily rows');
for (const row of recentDaily) console.log(JSON.stringify(select(row)));
console.log('## Recent weekly rows');
for (const row of recentWeekly) console.log(JSON.stringify(select(row)));
