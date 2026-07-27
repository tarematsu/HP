import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const rollupPath = 'worker/src/rollup-maintenance.js';
let rollup = readFileSync(rollupPath, 'utf8');
const marker = `// Maintenance state remains in Buddies DB. Summary source rows prefer MINUTE_DB's
// minute-backed sh_channel_snapshots compatibility view; UTC rollups are stored
// in OTHER_DB because only monitoring and Pages read them.
`;
if (!rollup.includes(marker)) throw new Error('rollup marker missing');
const helpers = `const IMMUTABLE_SUMMARY_STATE_ID = 'immutable-summary-rollups-v1';

async function summaryExists(db, table, key) {
  const row = await db.prepare(\`SELECT 1 AS present FROM \${table} WHERE period_key=? LIMIT 1\`)
    .bind(key).first();
  return Boolean(row);
}

async function distinctSourceMinutes(db, period) {
  const row = await db.prepare(\`SELECT COUNT(DISTINCT CAST(channel_id AS TEXT)||':'||CAST(observed_at/60000 AS INTEGER)) AS count
    FROM sh_channel_snapshots WHERE observed_at>=? AND observed_at<?\`)
    .bind(period.start, period.end).first();
  return Number(row?.count || 0);
}

async function blockedMinuteJobs(minuteDb, period) {
  const row = await minuteDb.prepare(\`SELECT COUNT(*) AS count
    FROM sh_minute_fact_jobs
    WHERE minute_at>=? AND minute_at<? AND status<>'done'\`)
    .bind(period.start, period.end).first();
  return Number(row?.count || 0);
}

async function immutableDailyReady(sourceDb, minuteDb, period) {
  const [sourceMinutes, factMinutes, blocked] = await Promise.all([
    distinctSourceMinutes(sourceDb, period),
    distinctSourceMinutes(minuteDb, period),
    blockedMinuteJobs(minuteDb, period),
  ]);
  return {
    ready: sourceMinutes > 0 && factMinutes >= sourceMinutes && blocked === 0,
    sourceMinutes,
    factMinutes,
    blocked,
  };
}

async function insertDailyOnce(sourceDb, minuteDb, otherDb, period, now) {
  if (await summaryExists(otherDb, 'sh_daily_summary', period.key)) {
    return { skipped: true, reason: 'already-generated', periodKey: period.key };
  }
  const readiness = await immutableDailyReady(sourceDb, minuteDb, period);
  if (!readiness.ready) {
    return { skipped: true, reason: 'minute-facts-incomplete', periodKey: period.key, readiness };
  }
  const aggregate = await minuteDb.prepare(\`SELECT MIN(observed_at) AS period_start,MAX(observed_at) AS period_end,
      COUNT(*) AS sample_count,COUNT(listener_count) AS reliable_sample_count,
      AVG(listener_count) AS listener_avg,MIN(listener_count) AS listener_min,
      MAX(listener_count) AS listener_max,NULL AS likes_max,NULL AS distinct_tracks,1 AS quality_score
    FROM sh_channel_snapshots WHERE observed_at>=? AND observed_at<?\`)
    .bind(period.start, period.end).first();
  const boundaries = await minuteDb.prepare(DAILY_BOUNDARIES_SQL)
    .bind(period.start, period.end).first();
  if (!aggregate || Number(aggregate.sample_count || 0) < 1) {
    return { skipped: true, reason: 'minute-facts-empty', periodKey: period.key, readiness };
  }
  const streamStart = finite(boundaries?.stream_start);
  const streamEnd = finite(boundaries?.stream_end);
  const memberStart = finite(boundaries?.member_start);
  const memberEnd = finite(boundaries?.member_end);
  await otherDb.prepare(\`INSERT INTO sh_daily_summary(
      period_key,period_start,period_end,sample_count,reliable_sample_count,
      listener_avg,listener_min,listener_max,stream_start,stream_end,stream_growth,
      member_start,member_end,member_growth,likes_max,distinct_tracks,primary_host,
      quality_score,quality_flags,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)\`)
    .bind(
      period.key, finite(aggregate.period_start), finite(aggregate.period_end),
      Number(aggregate.sample_count || 0),
      Number(aggregate.reliable_sample_count ?? aggregate.sample_count ?? 0),
      finite(aggregate.listener_avg), finite(aggregate.listener_min), finite(aggregate.listener_max),
      streamStart, streamEnd,
      streamStart != null && streamEnd != null && streamEnd >= streamStart ? streamEnd - streamStart : null,
      memberStart, memberEnd, memberStart != null && memberEnd != null ? memberEnd - memberStart : null,
      finite(aggregate.likes_max), finite(aggregate.distinct_tracks), boundaries?.primary_host || null,
      finite(aggregate.quality_score) ?? 1, '["immutable_daily"]', now,
    ).run();
  return { skipped: false, periodKey: period.key, readiness };
}

function dayKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

async function completeDailyRange(otherDb, range) {
  const expected = Math.round((range.end - range.start) / DAY_MS);
  const row = await otherDb.prepare(\`SELECT COUNT(*) AS count FROM sh_daily_summary
    WHERE period_key>=? AND period_key<?\`)
    .bind(dayKey(range.start), dayKey(range.end)).first();
  return Number(row?.count || 0) === expected;
}

async function insertWeeklyOnce(otherDb, range, now) {
  if (await summaryExists(otherDb, 'sh_weekly_summary', range.key)) {
    return { skipped: true, reason: 'already-generated', periodKey: range.key };
  }
  if (!(await completeDailyRange(otherDb, range))) {
    return { skipped: true, reason: 'daily-summaries-incomplete', periodKey: range.key };
  }
  const written = await rollupFromDaily(otherDb, 'sh_weekly_summary', range, now);
  return { skipped: !written, reason: written ? null : 'daily-summaries-empty', periodKey: range.key };
}

async function completeWeeklyCoverage(otherDb, monthRange) {
  const firstWeek = utcWeeklyRange(dayKey(monthRange.start));
  const lastWeek = utcWeeklyRange(dayKey(monthRange.end - 1));
  const expected = Math.round((lastWeek.start - firstWeek.start) / (7 * DAY_MS)) + 1;
  const row = await otherDb.prepare(\`SELECT COUNT(*) AS count FROM sh_weekly_summary
    WHERE period_start>=? AND period_start<=?\`)
    .bind(firstWeek.start, lastWeek.start).first();
  return Number(row?.count || 0) === expected;
}

async function insertMonthlyOnce(otherDb, range, now) {
  if (await summaryExists(otherDb, 'sh_monthly_summary', range.key)) {
    return { skipped: true, reason: 'already-generated', periodKey: range.key };
  }
  if (!(await completeWeeklyCoverage(otherDb, range))) {
    return { skipped: true, reason: 'weekly-summaries-incomplete', periodKey: range.key };
  }
  const written = await rollupFromDaily(otherDb, 'sh_monthly_summary', range, now);
  return { skipped: !written, reason: written ? null : 'daily-summaries-empty', periodKey: range.key };
}

`;
rollup = rollup.replace(marker, helpers + marker);
const start = rollup.indexOf('export async function runRollupMaintenance');
const end = rollup.indexOf('\nexport async function runRollupMaintenanceSafely', start + 1);
if (start < 0 || end < 0) throw new Error('runRollupMaintenance bounds missing');
const replacement = `export async function runRollupMaintenance(db, otherDb, minuteDb, now = Date.now()) {
  if (typeof minuteDb === 'number') {
    now = minuteDb;
    minuteDb = null;
  }
  if (!db || !otherDb || !minuteDb) return { skipped: true, reason: 'db-binding-missing' };
  const period = previousUtcDay(now);
  const daily = await insertDailyOnce(db, minuteDb, otherDb, period, now);
  const weekly = await insertWeeklyOnce(otherDb, utcWeeklyRange(period.key), now);
  const monthly = await insertMonthlyOnce(otherDb, utcMonthlyRange(period.key), now);
  await db.prepare(\`INSERT INTO sh_data_maintenance_state(
      id,last_rollup_key,last_cleanup_at,legacy_backfill_id,updated_at
    ) VALUES(?,?,0,0,?) ON CONFLICT(id) DO UPDATE SET
      last_rollup_key=excluded.last_rollup_key,updated_at=excluded.updated_at\`)
    .bind(IMMUTABLE_SUMMARY_STATE_ID, period.key, now).run();
  return {
    skipped: daily.skipped && weekly.skipped && monthly.skipped,
    periodKey: period.key,
    daily,
    weekly,
    monthly,
    legacyBackfill: { skipped: true, reason: 'legacy-migration-disabled' },
  };
}
`;
rollup = rollup.slice(0, start) + replacement + rollup.slice(end);
writeFileSync(rollupPath, rollup);

writeFileSync('tests/immutable-summary-rollups.test.mjs', `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../worker/src/rollup-maintenance.js', import.meta.url), 'utf8');

test('daily summaries are immutable and completeness-gated', () => {
  assert.match(source, /summaryExists\\(otherDb, 'sh_daily_summary'/);
  assert.match(source, /distinctSourceMinutes\\(sourceDb, period\\)/);
  assert.match(source, /distinctSourceMinutes\\(minuteDb, period\\)/);
  assert.match(source, /status<>'done'/);
  assert.match(source, /INSERT INTO sh_daily_summary/);
  assert.doesNotMatch(source, /INSERT INTO sh_daily_summary[\\s\\S]{0,800}ON CONFLICT/);
});

test('weekly and monthly promotion require complete lower summaries', () => {
  assert.match(source, /daily-summaries-incomplete/);
  assert.match(source, /weekly-summaries-incomplete/);
  assert.match(source, /insertWeeklyOnce/);
  assert.match(source, /insertMonthlyOnce/);
});
`);

for (const path of [
  'placeholder', 'placeholder2', 'placeholder3', 'placeholder4', 'placeholder5',
  '.github/scripts/apply-immutable-summary-rollups.mjs',
  '.github/workflows/apply-immutable-summary-rollups.yml',
]) {
  if (existsSync(path)) unlinkSync(path);
}
