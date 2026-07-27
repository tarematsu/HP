import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

function replace(path, from, to) {
  const source = readFileSync(path, 'utf8');
  if (!source.includes(from)) throw new Error(`pattern missing in ${path}: ${from.slice(0, 80)}`);
  writeFileSync(path, source.replace(from, to));
}

replace(
  'worker/src/pages-track-history-support.js',
  '  const toTs = currentDayStart + DAY_MS;',
  '  // Only closed UTC days are eligible for immutable read models.\n  const toTs = currentDayStart;',
);

replace(
  'worker/src/pages-track-history-stage.js',
  `    ), queue_starts AS (\n      SELECT DISTINCT items.station_id,items.start_time\n      FROM sh_queue_items items\n      CROSS JOIN queue_bounds bounds\n      WHERE items.start_time IS NOT NULL\n        AND items.start_time>=bounds.range_end-\${TRACK_HISTORY_QUEUE_LOOKBACK_MS}\n        AND items.start_time<bounds.range_end\n    )`,
  `    ), queue_starts AS (\n      SELECT starts.station_id,starts.start_time\n      FROM sh_track_history_queue_starts starts\n      CROSS JOIN queue_bounds bounds\n      WHERE starts.start_time>=bounds.range_end-\${TRACK_HISTORY_QUEUE_LOOKBACK_MS}\n        AND starts.start_time<bounds.range_end\n    )`,
);

const rollupPath = 'worker/src/rollup-maintenance.js';
let rollup = readFileSync(rollupPath, 'utf8');
const marker = `// Maintenance state remains in Buddies DB. Summary source rows prefer MINUTE_DB's\n// minute-backed sh_channel_snapshots compatibility view; UTC rollups are stored\n// in OTHER_DB because only monitoring and Pages read them.\n`;
if (!rollup.includes(marker)) throw new Error('rollup marker missing');
const helpers = `const IMMUTABLE_SUMMARY_STATE_ID = 'immutable-summary-rollups-v1';\n\nasync function summaryExists(db, table, key) {\n  const row = await db.prepare(\`SELECT 1 AS present FROM \${table} WHERE period_key=? LIMIT 1\`)\n    .bind(key).first();\n  return Boolean(row);\n}\n\nasync function distinctSourceMinutes(db, period) {\n  const row = await db.prepare(\`SELECT COUNT(DISTINCT CAST(channel_id AS TEXT)||':'||CAST(observed_at/60000 AS INTEGER)) AS count\n    FROM sh_channel_snapshots WHERE observed_at>=? AND observed_at<?\`)\n    .bind(period.start, period.end).first();\n  return Number(row?.count || 0);\n}\n\nasync function blockedMinuteJobs(minuteDb, period) {\n  const row = await minuteDb.prepare(\`SELECT COUNT(*) AS count\n    FROM sh_minute_fact_jobs\n    WHERE minute_at>=? AND minute_at<? AND status<>'done'\`)\n    .bind(period.start, period.end).first();\n  return Number(row?.count || 0);\n}\n\nasync function immutableDailyReady(sourceDb, minuteDb, period) {\n  const [sourceMinutes, factMinutes, blocked] = await Promise.all([\n    distinctSourceMinutes(sourceDb, period),\n    distinctSourceMinutes(minuteDb, period),\n    blockedMinuteJobs(minuteDb, period),\n  ]);\n  return {\n    ready: sourceMinutes > 0 && factMinutes >= sourceMinutes && blocked === 0,\n    sourceMinutes,\n    factMinutes,\n    blocked,\n  };\n}\n\nasync function insertDailyOnce(sourceDb, minuteDb, otherDb, period, now) {\n  if (await summaryExists(otherDb, 'sh_daily_summary', period.key)) {\n    return { skipped: true, reason: 'already-generated', periodKey: period.key };\n  }\n  const readiness = await immutableDailyReady(sourceDb, minuteDb, period);\n  if (!readiness.ready) {\n    return { skipped: true, reason: 'minute-facts-incomplete', periodKey: period.key, readiness };\n  }\n  const aggregate = await minuteDb.prepare(\`SELECT MIN(observed_at) AS period_start,MAX(observed_at) AS period_end,\n      COUNT(*) AS sample_count,COUNT(listener_count) AS reliable_sample_count,\n      AVG(listener_count) AS listener_avg,MIN(listener_count) AS listener_min,\n      MAX(listener_count) AS listener_max,NULL AS likes_max,NULL AS distinct_tracks,1 AS quality_score\n    FROM sh_channel_snapshots WHERE observed_at>=? AND observed_at<?\`)\n    .bind(period.start, period.end).first();\n  const boundaries = await minuteDb.prepare(DAILY_BOUNDARIES_SQL)\n    .bind(period.start, period.end).first();\n  if (!aggregate || Number(aggregate.sample_count || 0) < 1) {\n    return { skipped: true, reason: 'minute-facts-empty', periodKey: period.key, readiness };\n  }\n  const streamStart = finite(boundaries?.stream_start);\n  const streamEnd = finite(boundaries?.stream_end);\n  const memberStart = finite(boundaries?.member_start);\n  const memberEnd = finite(boundaries?.member_end);\n  await otherDb.prepare(\`INSERT INTO sh_daily_summary(\n      period_key,period_start,period_end,sample_count,reliable_sample_count,\n      listener_avg,listener_min,listener_max,stream_start,stream_end,stream_growth,\n      member_start,member_end,member_growth,likes_max,distinct_tracks,primary_host,\n      quality_score,quality_flags,updated_at\n    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)\`)\n    .bind(\n      period.key, finite(aggregate.period_start), finite(aggregate.period_end),\n      Number(aggregate.sample_count || 0),\n      Number(aggregate.reliable_sample_count ?? aggregate.sample_count ?? 0),\n      finite(aggregate.listener_avg), finite(aggregate.listener_min), finite(aggregate.listener_max),\n      streamStart, streamEnd,\n      streamStart != null && streamEnd != null && streamEnd >= streamStart ? streamEnd - streamStart : null,\n      memberStart, memberEnd, memberStart != null && memberEnd != null ? memberEnd - memberStart : null,\n      finite(aggregate.likes_max), finite(aggregate.distinct_tracks), boundaries?.primary_host || null,\n      finite(aggregate.quality_score) ?? 1, '[\"immutable_daily\"]', now,\n    ).run();\n  return { skipped: false, periodKey: period.key, readiness };\n}\n\nfunction dayKey(timestamp) {\n  return new Date(timestamp).toISOString().slice(0, 10);\n}\n\nasync function completeDailyRange(otherDb, range) {\n  const expected = Math.round((range.end - range.start) / DAY_MS);\n  const row = await otherDb.prepare(\`SELECT COUNT(*) AS count FROM sh_daily_summary\n    WHERE period_key>=? AND period_key<?\`)\n    .bind(dayKey(range.start), dayKey(range.end)).first();\n  return Number(row?.count || 0) === expected;\n}\n\nasync function insertWeeklyOnce(otherDb, range, now) {\n  if (await summaryExists(otherDb, 'sh_weekly_summary', range.key)) {\n    return { skipped: true, reason: 'already-generated', periodKey: range.key };\n  }\n  if (!(await completeDailyRange(otherDb, range))) {\n    return { skipped: true, reason: 'daily-summaries-incomplete', periodKey: range.key };\n  }\n  const written = await rollupFromDaily(otherDb, 'sh_weekly_summary', range, now);\n  return { skipped: !written, reason: written ? null : 'daily-summaries-empty', periodKey: range.key };\n}\n\nasync function completeWeeklyCoverage(otherDb, monthRange) {\n  const firstWeek = utcWeeklyRange(dayKey(monthRange.start));\n  const lastWeek = utcWeeklyRange(dayKey(monthRange.end - 1));\n  const expected = Math.round((lastWeek.start - firstWeek.start) / (7 * DAY_MS)) + 1;\n  const row = await otherDb.prepare(\`SELECT COUNT(*) AS count FROM sh_weekly_summary\n    WHERE period_start>=? AND period_start<=?\`)\n    .bind(firstWeek.start, lastWeek.start).first();\n  return Number(row?.count || 0) === expected;\n}\n\nasync function insertMonthlyOnce(otherDb, range, now) {\n  if (await summaryExists(otherDb, 'sh_monthly_summary', range.key)) {\n    return { skipped: true, reason: 'already-generated', periodKey: range.key };\n  }\n  if (!(await completeWeeklyCoverage(otherDb, range))) {\n    return { skipped: true, reason: 'weekly-summaries-incomplete', periodKey: range.key };\n  }\n  // Weekly completion is the promotion gate. Daily rows retain exact calendar-month boundaries.\n  const written = await rollupFromDaily(otherDb, 'sh_monthly_summary', range, now);\n  return { skipped: !written, reason: written ? null : 'daily-summaries-empty', periodKey: range.key };\n}\n\n`;
rollup = rollup.replace(marker, helpers + marker);
const start = rollup.indexOf('export async function runRollupMaintenance');
const end = rollup.indexOf('\nexport async function runRoll', start + 10);
if (start < 0 || end < 0) throw new Error('runRollupMaintenance bounds missing');
const replacement = `export async function runRollupMaintenance(db, otherDb, minuteDb, now = Date.now()) {\n  if (typeof minuteDb === 'number') {\n    now = minuteDb;\n    minuteDb = null;\n  }\n  if (!db || !otherDb || !minuteDb) return { skipped: true, reason: 'db-binding-missing' };\n  const period = previousUtcDay(now);\n  const daily = await insertDailyOnce(db, minuteDb, otherDb, period, now);\n  const week = utcWeeklyRange(period.key);\n  const weekly = await insertWeeklyOnce(otherDb, week, now);\n  const month = utcMonthlyRange(period.key);\n  const monthly = await insertMonthlyOnce(otherDb, month, now);\n  await db.prepare(\`INSERT INTO sh_data_maintenance_state(\n      id,last_rollup_key,last_cleanup_at,legacy_backfill_id,updated_at\n    ) VALUES(?,?,0,0,?) ON CONFLICT(id) DO UPDATE SET\n      last_rollup_key=excluded.last_rollup_key,updated_at=excluded.updated_at\`)\n    .bind(IMMUTABLE_SUMMARY_STATE_ID, period.key, now).run();\n  return {\n    skipped: daily.skipped && weekly.skipped && monthly.skipped,\n    periodKey: period.key,\n    daily,\n    weekly,\n    monthly,\n    legacyBackfill: { skipped: true, reason: 'legacy-migration-disabled' },\n  };\n}\n`;
rollup = rollup.slice(0, start) + replacement + rollup.slice(end);
writeFileSync(rollupPath, rollup);

replace(
  'worker/tests/pages-read-model-ranges.test.js',
  `  assert.deepEqual(ranges.recent, {\n    fromTs: currentDay - 35 * DAY_MS,\n    toTs: currentDay + DAY_MS,\n  });`,
  `  assert.deepEqual(ranges.recent, {\n    fromTs: currentDay - 35 * DAY_MS,\n    toTs: currentDay,\n  });`,
);
replace(
  'worker/tests/pages-read-model-ranges.test.js',
  `  assert.deepEqual(ranges.recent, {\n    fromTs: currentDay - DAY_MS,\n    toTs: currentDay + DAY_MS,\n  });`,
  `  assert.deepEqual(ranges.recent, {\n    fromTs: currentDay - DAY_MS,\n    toTs: currentDay,\n  });`,
);
replace(
  'tests/d1-budget-regressions.test.mjs',
  `  assert.equal(ranges.recent.toTs, currentDay + DAY_MS);`,
  `  assert.equal(ranges.recent.toTs, currentDay);`,
);
replace(
  'tests/d1-budget-regressions.test.mjs',
  `  assert.match(bounded, /items\\.start_time>=bounds\\.range_end-172800000/);`,
  `  assert.match(bounded, /starts\\.start_time>=bounds\\.range_end-172800000/);\n  assert.match(bounded, /FROM sh_track_history_queue_starts starts/);`,
);

const immutableTest = `import assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\nimport test from 'node:test';\n\nconst source = readFileSync(new URL('../worker/src/rollup-maintenance.js', import.meta.url), 'utf8');\n\ntest('daily summaries are immutable and gated by source/fact completeness', () => {\n  assert.match(source, /summaryExists\\(otherDb, 'sh_daily_summary'/);\n  assert.match(source, /distinctSourceMinutes\\(sourceDb, period\\)/);\n  assert.match(source, /distinctSourceMinutes\\(minuteDb, period\\)/);\n  assert.match(source, /status<>'done'/);\n  assert.match(source, /INSERT INTO sh_daily_summary/);\n  assert.doesNotMatch(source, /INSERT INTO sh_daily_summary[\\s\\S]{0,800}ON CONFLICT/);\n});\n\ntest('weekly and monthly promotion require complete lower-level summaries', () => {\n  assert.match(source, /daily-summaries-incomplete/);\n  assert.match(source, /weekly-summaries-incomplete/);\n  assert.match(source, /insertWeeklyOnce/);\n  assert.match(source, /insertMonthlyOnce/);\n});\n`;
writeFileSync('tests/immutable-summary-rollups.test.mjs', immutableTest);

unlinkSync('.github/scripts/apply-immutable-summary-rollups.mjs');
unlinkSync('.github/workflows/apply-immutable-summary-rollups.yml');
