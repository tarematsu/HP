import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

function replace(path, from, to) {
  const source = readFileSync(path, 'utf8');
  if (!source.includes(from)) throw new Error(`pattern missing in ${path}`);
  writeFileSync(path, source.replace(from, to));
}

const path = 'worker/src/rollup-maintenance.js';
let source = readFileSync(path, 'utf8');

source = source.replace(
`async function summaryExists(db, table, key) {
  const row = await db.prepare(\`SELECT 1 AS present FROM \${table} WHERE period_key=? LIMIT 1\`)
    .bind(key).first();
  return Boolean(row);
}`,
`async function loadSummary(db, table, key) {
  return db.prepare(\`SELECT period_key,sample_count,updated_at FROM \${table}
    WHERE period_key=? LIMIT 1\`).bind(key).first();
}`,
);

source = source.replace(
`async function insertDailyOnce(sourceDb, minuteDb, otherDb, period, now) {
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
      finite(aggregate.quality_score) ?? 1, '[\"immutable_daily\"]', now,
    ).run();
  return { skipped: false, periodKey: period.key, readiness };
}`,
`async function rebuildDailyWhenComplete(sourceDb, minuteDb, otherDb, period, now) {
  const [existing, readiness] = await Promise.all([
    loadSummary(otherDb, 'sh_daily_summary', period.key),
    immutableDailyReady(sourceDb, minuteDb, period),
  ]);
  if (!readiness.ready) {
    return {
      skipped: true,
      reason: 'minute-facts-incomplete',
      periodKey: period.key,
      existingSampleCount: Number(existing?.sample_count || 0),
      readiness,
    };
  }
  if (existing && Number(existing.sample_count || 0) === readiness.factMinutes) {
    return { skipped: true, reason: 'already-current', periodKey: period.key, readiness };
  }
  const written = await rollupDaily(minuteDb, otherDb, period, now);
  return {
    skipped: !written,
    rebuilt: Boolean(existing && written),
    reason: written ? null : 'minute-facts-empty',
    periodKey: period.key,
    previousSampleCount: Number(existing?.sample_count || 0),
    readiness,
  };
}`,
);

source = source.replace(
`async function insertWeeklyOnce(otherDb, range, now) {
  if (await summaryExists(otherDb, 'sh_weekly_summary', range.key)) {
    return { skipped: true, reason: 'already-generated', periodKey: range.key };
  }
  if (!(await completeDailyRange(otherDb, range))) {
    return { skipped: true, reason: 'daily-summaries-incomplete', periodKey: range.key };
  }
  const written = await rollupFromDaily(otherDb, 'sh_weekly_summary', range, now);
  return { skipped: !written, reason: written ? null : 'daily-summaries-empty', periodKey: range.key };
}`,
`async function refreshWeekly(otherDb, range, now, force = false) {
  const existing = await loadSummary(otherDb, 'sh_weekly_summary', range.key);
  if (existing && !force) {
    return { skipped: true, reason: 'already-current', periodKey: range.key };
  }
  if (!(await completeDailyRange(otherDb, range))) {
    return { skipped: true, reason: 'daily-summaries-incomplete', periodKey: range.key };
  }
  const written = await rollupFromDaily(otherDb, 'sh_weekly_summary', range, now);
  return { skipped: !written, rebuilt: Boolean(existing && written), reason: written ? null : 'daily-summaries-empty', periodKey: range.key };
}`,
);

source = source.replace(
`async function insertMonthlyOnce(otherDb, range, now) {
  if (await summaryExists(otherDb, 'sh_monthly_summary', range.key)) {
    return { skipped: true, reason: 'already-generated', periodKey: range.key };
  }
  if (!(await completeWeeklyCoverage(otherDb, range))) {
    return { skipped: true, reason: 'weekly-summaries-incomplete', periodKey: range.key };
  }
  const written = await rollupFromDaily(otherDb, 'sh_monthly_summary', range, now);
  return { skipped: !written, reason: written ? null : 'daily-summaries-empty', periodKey: range.key };
}`,
`async function refreshMonthly(otherDb, range, now, force = false) {
  const existing = await loadSummary(otherDb, 'sh_monthly_summary', range.key);
  if (existing && !force) {
    return { skipped: true, reason: 'already-current', periodKey: range.key };
  }
  if (!(await completeWeeklyCoverage(otherDb, range))) {
    return { skipped: true, reason: 'weekly-summaries-incomplete', periodKey: range.key };
  }
  const written = await rollupFromDaily(otherDb, 'sh_monthly_summary', range, now);
  return { skipped: !written, rebuilt: Boolean(existing && written), reason: written ? null : 'daily-summaries-empty', periodKey: range.key };
}`,
);

source = source.replace(
`  const daily = await insertDailyOnce(db, minuteDb, otherDb, period, now);
  const weekly = await insertWeeklyOnce(otherDb, utcWeeklyRange(period.key), now);
  const monthly = await insertMonthlyOnce(otherDb, utcMonthlyRange(period.key), now);`,
`  const daily = await rebuildDailyWhenComplete(db, minuteDb, otherDb, period, now);
  const weekRange = utcWeeklyRange(period.key);
  const weekly = await refreshWeekly(otherDb, weekRange, now, daily.rebuilt === true);
  const monthRange = utcMonthlyRange(period.key);
  const monthly = await refreshMonthly(
    otherDb,
    monthRange,
    now,
    daily.rebuilt === true || weekly.rebuilt === true,
  );`,
);

if (source === readFileSync(path, 'utf8')) throw new Error('rollup source unchanged');
writeFileSync(path, source);

replace(
  'tests/immutable-summary-rollups.test.mjs',
  `test('daily summaries are immutable and completeness-gated', () => {
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
});`,
  `test('daily summaries rebuild only after minute facts catch up with BUDDIES', () => {
  assert.match(source, /loadSummary\\(otherDb, 'sh_daily_summary'/);
  assert.match(source, /distinctSourceMinutes\\(sourceDb, period\\)/);
  assert.match(source, /distinctSourceMinutes\\(minuteDb, period\\)/);
  assert.match(source, /status<>'done'/);
  assert.match(source, /existingSampleCount/);
  assert.match(source, /existing\\.sample_count \\|\\| 0\\) === readiness\\.factMinutes/);
  assert.match(source, /rollupDaily\\(minuteDb, otherDb, period, now\\)/);
});

test('daily rebuild cascades to weekly and monthly summaries', () => {
  assert.match(source, /refreshWeekly\\(otherDb, weekRange, now, daily\\.rebuilt === true\\)/);
  assert.match(source, /daily\\.rebuilt === true \\|\\| weekly\\.rebuilt === true/);
  assert.match(source, /daily-summaries-incomplete/);
  assert.match(source, /weekly-summaries-incomplete/);
});`,
);

unlinkSync('.github/scripts/apply-daily-summary-rebuild.mjs');
unlinkSync('.github/workflows/apply-daily-summary-rebuild.yml');
