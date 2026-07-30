import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const MAX_CARRY_MINUTES = 5;
const workerRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(workerRoot, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const root = resolve(repositoryRoot, '.local-minute-facts');
const generatedDirectory = resolve(root, 'generated');
const otherDatabase = process.env.OTHER_DATABASE_NAME || 'stationhead-other';

function wrangler(database, command, options = {}) {
  const args = [wranglerScript, 'd1', 'execute', database, '--remote', '--yes'];
  if (options.json !== false) args.push('--json');
  if (options.file) args.push('--file', options.file);
  else args.push('--command', command);
  return execFileSync(process.execPath, args, {
    cwd: workerRoot,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function rowsFromWrangler(output) {
  const text = String(output || '').trim();
  const starts = [text.indexOf('['), text.indexOf('{')].filter((index) => index >= 0);
  if (!starts.length) throw new Error(`Wrangler did not return JSON: ${text.slice(0, 500)}`);
  const payload = JSON.parse(text.slice(Math.min(...starts)));
  const containers = Array.isArray(payload) ? payload : [payload];
  for (const container of containers) {
    const rows = container?.results || container?.result?.results || container?.result?.[0]?.results;
    if (Array.isArray(rows)) return rows;
  }
  return [];
}

function finite(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value) {
  const parsed = finite(value);
  return parsed == null ? null : Math.trunc(parsed);
}

function dayStart(timestamp) {
  return Math.floor(Number(timestamp) / DAY_MS) * DAY_MS;
}

function dayKey(timestamp) {
  return new Date(dayStart(timestamp)).toISOString().slice(0, 10);
}

function monthStart(timestamp) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function weekStart(timestamp) {
  const start = dayStart(timestamp);
  const weekday = new Date(start).getUTCDay();
  return start - ((weekday + 6) % 7) * DAY_MS;
}

function weekKey(timestamp) {
  return dayKey(weekStart(timestamp));
}

function minuteBucket(timestamp) {
  return Math.floor(Number(timestamp) / MINUTE_MS) * MINUTE_MS;
}

function buildCandidates(sourceRows, start, cutoff) {
  const sorted = [...sourceRows].sort((left, right) =>
    Number(left.observed_at) - Number(right.observed_at) || Number(left.id) - Number(right.id));
  const candidates = new Map();
  const previousByChannel = new Map();
  for (const row of sorted) {
    const channelId = integer(row.channel_id);
    const observedAt = integer(row.observed_at);
    if (channelId == null || observedAt == null) continue;
    const currentMinute = minuteBucket(observedAt);
    const previous = previousByChannel.get(channelId);
    if (previous && integer(previous.station_id) === integer(row.station_id)) {
      const previousMinute = minuteBucket(previous.observed_at);
      const gapMinutes = Math.trunc((currentMinute - previousMinute) / MINUTE_MS);
      const sameBroadcast = integer(previous.is_broadcasting) === integer(row.is_broadcasting)
        && integer(previous.broadcast_start_time) === integer(row.broadcast_start_time);
      if (sameBroadcast && gapMinutes > 1 && gapMinutes <= MAX_CARRY_MINUTES) {
        for (let minuteAt = previousMinute + MINUTE_MS; minuteAt < currentMinute; minuteAt += MINUTE_MS) {
          candidates.set(`${channelId}:${minuteAt}`, {
            minute_at: minuteAt,
            observed_at: minuteAt + 30_000,
            mode: 'carry_forward',
            snapshot: previous,
          });
        }
      }
    }
    candidates.set(`${channelId}:${currentMinute}`, {
      minute_at: currentMinute,
      observed_at: observedAt,
      mode: 'exact',
      snapshot: row,
    });
    previousByChannel.set(channelId, row);
  }
  return [...candidates.values()]
    .filter((item) => item.minute_at >= start && item.minute_at < cutoff)
    .sort((left, right) => left.minute_at - right.minute_at
      || Number(left.snapshot.channel_id) - Number(right.snapshot.channel_id));
}

function streamValue(snapshot) {
  const current = finite(snapshot.current_stream_count);
  const total = finite(snapshot.total_listens);
  return current != null && current >= 0 && current !== total ? current : null;
}

function summarizeDay(key, items, updatedAt) {
  let listenerSum = 0;
  let reliable = 0;
  let listenerMin = null;
  let listenerMax = null;
  let streamStart = null;
  let streamEnd = null;
  let memberStart = null;
  let memberEnd = null;
  const hosts = new Map();
  for (const item of items) {
    const listener = finite(item.snapshot.listener_count);
    if (listener != null) {
      listenerSum += listener;
      reliable += 1;
      listenerMin = listenerMin == null ? listener : Math.min(listenerMin, listener);
      listenerMax = listenerMax == null ? listener : Math.max(listenerMax, listener);
    }
    const stream = streamValue(item.snapshot);
    if (stream != null) {
      if (streamStart == null) streamStart = stream;
      streamEnd = stream;
    }
    const members = finite(item.snapshot.total_member_count);
    if (members != null) {
      if (memberStart == null) memberStart = members;
      memberEnd = members;
    }
    const host = String(item.snapshot.host_handle || '').trim();
    if (host) hosts.set(host, (hosts.get(host) || 0) + 1);
  }
  const primaryHost = [...hosts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;
  return {
    period_key: key,
    period_start: Math.min(...items.map((item) => Number(item.observed_at))),
    period_end: Math.max(...items.map((item) => Number(item.observed_at))),
    sample_count: items.length,
    reliable_sample_count: reliable,
    listener_avg: reliable ? listenerSum / reliable : null,
    listener_min: listenerMin,
    listener_max: listenerMax,
    stream_start: streamStart,
    stream_end: streamEnd,
    stream_growth: streamStart != null && streamEnd != null && streamEnd >= streamStart
      ? streamEnd - streamStart : null,
    member_start: memberStart,
    member_end: memberEnd,
    member_growth: memberStart != null && memberEnd != null ? memberEnd - memberStart : null,
    likes_max: null,
    distinct_tracks: null,
    primary_host: primaryHost,
    quality_score: 1,
    quality_flags: '["range_backfill","minute_facts"]',
    updated_at: updatedAt,
  };
}

function summarizeAggregate(key, rows, updatedAt, kind) {
  const sorted = [...rows].sort((a, b) => String(a.period_key).localeCompare(String(b.period_key)));
  const reliableWeight = sorted.reduce((sum, row) => sum + (finite(row.listener_avg) == null ? 0 : Number(row.reliable_sample_count || 0)), 0);
  const weightedListener = sorted.reduce((sum, row) => sum
    + (finite(row.listener_avg) == null ? 0 : Number(row.listener_avg) * Number(row.reliable_sample_count || 0)), 0);
  const qualityWeight = sorted.reduce((sum, row) => sum + Number(row.reliable_sample_count || 0), 0);
  const weightedQuality = sorted.reduce((sum, row) => sum
    + Number(row.quality_score ?? 1) * Number(row.reliable_sample_count || 0), 0);
  const firstWith = (field) => sorted.find((row) => finite(row[field]) != null)?.[field] ?? null;
  const lastWith = (field) => [...sorted].reverse().find((row) => finite(row[field]) != null)?.[field] ?? null;
  const streamStart = finite(firstWith('stream_start'));
  const streamEnd = finite(lastWith('stream_end'));
  const memberStart = finite(firstWith('member_start'));
  const memberEnd = finite(lastWith('member_end'));
  const hosts = new Map();
  for (const row of sorted) {
    const host = String(row.primary_host || '').trim();
    if (host) hosts.set(host, (hosts.get(host) || 0) + Number(row.reliable_sample_count || 0));
  }
  const primaryHost = [...hosts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;
  const mins = sorted.map((row) => finite(row.listener_min)).filter((value) => value != null);
  const maxes = sorted.map((row) => finite(row.listener_max)).filter((value) => value != null);
  const likes = sorted.map((row) => finite(row.likes_max)).filter((value) => value != null);
  return {
    period_key: key,
    period_start: Math.min(...sorted.map((row) => Number(row.period_start))),
    period_end: Math.max(...sorted.map((row) => Number(row.period_end))),
    sample_count: sorted.reduce((sum, row) => sum + Number(row.sample_count || 0), 0),
    reliable_sample_count: sorted.reduce((sum, row) => sum + Number(row.reliable_sample_count || 0), 0),
    listener_avg: reliableWeight ? weightedListener / reliableWeight : null,
    listener_min: mins.length ? Math.min(...mins) : null,
    listener_max: maxes.length ? Math.max(...maxes) : null,
    stream_start: streamStart,
    stream_end: streamEnd,
    stream_growth: streamStart != null && streamEnd != null && streamEnd >= streamStart
      ? streamEnd - streamStart : null,
    member_start: memberStart,
    member_end: memberEnd,
    member_growth: memberStart != null && memberEnd != null ? memberEnd - memberStart : null,
    likes_max: likes.length ? Math.max(...likes) : null,
    distinct_tracks: null,
    primary_host: primaryHost,
    quality_score: qualityWeight ? weightedQuality / qualityWeight : 1,
    quality_flags: `["range_backfill","${kind}_from_daily"]`,
    updated_at: updatedAt,
  };
}

const COLUMNS = [
  'period_key', 'period_start', 'period_end', 'sample_count', 'reliable_sample_count',
  'listener_avg', 'listener_min', 'listener_max', 'stream_start', 'stream_end', 'stream_growth',
  'member_start', 'member_end', 'member_growth', 'likes_max', 'distinct_tracks', 'primary_host',
  'quality_score', 'quality_flags', 'updated_at',
];

function literal(value) {
  if (value == null) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite summary value');
    return String(value);
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function upsertStatement(table, row) {
  const values = COLUMNS.map((column) => literal(row[column])).join(',');
  const updates = COLUMNS.slice(1).map((column) => `${column}=excluded.${column}`).join(',');
  return `INSERT INTO ${table}(${COLUMNS.join(',')}) VALUES(${values}) `
    + `ON CONFLICT(period_key) DO UPDATE SET ${updates};`;
}

function normalizeStored(row) {
  const normalized = { ...row };
  for (const column of COLUMNS) {
    if (column === 'period_key' || column === 'primary_host' || column === 'quality_flags') continue;
    normalized[column] = finite(row[column]);
  }
  return normalized;
}

function generate() {
  mkdirSync(generatedDirectory, { recursive: true });
  const range = JSON.parse(readFileSync(resolve(root, 'range.json'), 'utf8'));
  const snapshots = rowsFromWrangler(readFileSync(resolve(root, 'snapshots.json'), 'utf8'));
  const candidates = buildCandidates(snapshots, range.from_ms, range.cutoff_ms);
  const byDay = new Map();
  for (const candidate of candidates) {
    const key = dayKey(candidate.minute_at);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(candidate);
  }
  const updatedAt = Date.now();
  const daily = [...byDay.entries()].map(([key, items]) => summarizeDay(key, items, updatedAt));
  const coverageStart = monthStart(range.from_ms);
  const coverageEndKey = dayKey(range.cutoff_ms);
  const storedDaily = rowsFromWrangler(wrangler(
    otherDatabase,
    `SELECT ${COLUMNS.join(',')} FROM sh_daily_summary
      WHERE period_key>='${dayKey(coverageStart)}' AND period_key<='${coverageEndKey}'
      ORDER BY period_key ASC`,
  )).map(normalizeStored);
  const mergedDaily = new Map(storedDaily.map((row) => [row.period_key, row]));
  for (const row of daily) mergedDaily.set(row.period_key, row);

  const affectedWeeks = new Set(daily.map((row) => weekKey(Date.parse(`${row.period_key}T00:00:00Z`))));
  const affectedMonths = new Set(daily.map((row) => row.period_key.slice(0, 7)));
  const weekly = [];
  for (const key of affectedWeeks) {
    const start = Date.parse(`${key}T00:00:00Z`);
    const end = start + 7 * DAY_MS;
    const rows = [...mergedDaily.values()].filter((row) => {
      const timestamp = Date.parse(`${row.period_key}T00:00:00Z`);
      return timestamp >= start && timestamp < end;
    });
    if (rows.length) weekly.push(summarizeAggregate(key, rows, updatedAt, 'weekly'));
  }
  const monthly = [];
  for (const key of affectedMonths) {
    const rows = [...mergedDaily.values()].filter((row) => row.period_key.startsWith(`${key}-`));
    if (rows.length) monthly.push(summarizeAggregate(key, rows, updatedAt, 'monthly'));
  }

  const statements = [
    ...daily.map((row) => upsertStatement('sh_daily_summary', row)),
    ...weekly.map((row) => upsertStatement('sh_weekly_summary', row)),
    ...monthly.map((row) => upsertStatement('sh_monthly_summary', row)),
  ];
  const sqlPath = resolve(generatedDirectory, 'history-summaries.sql');
  writeFileSync(sqlPath, `${statements.join('\n')}\n`);
  const manifest = {
    event: 'history_summary_range_generation',
    from_ms: range.from_ms,
    cutoff_ms: range.cutoff_ms,
    candidates: candidates.length,
    daily,
    weekly,
    monthly,
    sql_file: sqlPath,
    statements: statements.length,
  };
  writeFileSync(resolve(generatedDirectory, 'summary-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({
    event: manifest.event,
    from_ms: manifest.from_ms,
    cutoff_ms: manifest.cutoff_ms,
    candidates: manifest.candidates,
    daily: daily.length,
    weekly: weekly.length,
    monthly: monthly.length,
    statements: statements.length,
  }));
}

function sameNumber(expected, actual, tolerance = 1e-9) {
  if (expected == null || actual == null) return expected == null && actual == null;
  return Math.abs(Number(expected) - Number(actual)) <= tolerance * Math.max(1, Math.abs(Number(expected)));
}

function verifyRows(table, expectedRows) {
  if (!expectedRows.length) return [];
  const keys = expectedRows.map((row) => literal(row.period_key)).join(',');
  const actualRows = rowsFromWrangler(wrangler(
    otherDatabase,
    `SELECT ${COLUMNS.join(',')} FROM ${table} WHERE period_key IN (${keys}) ORDER BY period_key ASC`,
  ));
  const actual = new Map(actualRows.map((row) => [String(row.period_key), row]));
  const mismatches = [];
  for (const expected of expectedRows) {
    const row = actual.get(expected.period_key);
    if (!row) {
      mismatches.push({ table, period_key: expected.period_key, reason: 'missing' });
      continue;
    }
    for (const column of COLUMNS.slice(1)) {
      if (column === 'quality_flags' || column === 'primary_host') {
        if (String(row[column] ?? '') !== String(expected[column] ?? '')) {
          mismatches.push({ table, period_key: expected.period_key, column, expected: expected[column], actual: row[column] });
        }
      } else if (!sameNumber(expected[column], finite(row[column]))) {
        mismatches.push({ table, period_key: expected.period_key, column, expected: expected[column], actual: row[column] });
      }
    }
  }
  return mismatches;
}

function verify() {
  const manifest = JSON.parse(readFileSync(resolve(generatedDirectory, 'summary-manifest.json'), 'utf8'));
  const mismatches = [
    ...verifyRows('sh_daily_summary', manifest.daily),
    ...verifyRows('sh_weekly_summary', manifest.weekly),
    ...verifyRows('sh_monthly_summary', manifest.monthly),
  ];
  const report = {
    event: 'history_summary_range_verification',
    daily: manifest.daily.length,
    weekly: manifest.weekly.length,
    monthly: manifest.monthly.length,
    mismatches: mismatches.length,
    first_mismatches: mismatches.slice(0, 20),
  };
  writeFileSync(resolve(generatedDirectory, 'summary-verification.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
  if (mismatches.length) throw new Error('history summary range verification failed');
}

const command = process.argv[2] || 'generate';
if (command === 'generate') generate();
else if (command === 'verify') verify();
else throw new Error(`unsupported command: ${command}`);
