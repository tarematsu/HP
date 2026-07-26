import {
  KNOWN_DAILY_STREAM_GAPS,
  PERIOD_BOUNDARY_TOLERANCE_MS,
  expectedPeriodBounds,
  isTrustedEmailWeekly,
  periodBoundaryToleranceMs,
  withinPeriodBoundaryTolerance,
} from './period-completeness.js';

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function periodBoundaryEvidenceSql(toleranceMs = PERIOD_BOUNDARY_TOLERANCE_MS) {
  return `WITH periods AS (
    SELECT
      json_extract(value,'$.period_key') AS period_key,
      CAST(json_extract(value,'$.period_start') AS INTEGER) AS period_start,
      CAST(json_extract(value,'$.period_end') AS INTEGER) AS period_end
    FROM json_each(?)
  ), boundaries AS (
    SELECT period_key,'start' AS boundary_name,period_start AS target_at FROM periods
    UNION ALL
    SELECT period_key,'end' AS boundary_name,period_end AS target_at FROM periods
  ), candidates AS (
    SELECT boundaries.period_key,boundaries.boundary_name,boundaries.target_at,
      snapshots.observed_at,
      COALESCE(snapshots.current_stream_count,snapshots.total_listens) AS stream_value,
      snapshots.total_member_count AS member_value,0 AS source_priority,snapshots.id AS source_id
    FROM boundaries
    JOIN sh_channel_snapshots snapshots
      ON snapshots.observed_at BETWEEN boundaries.target_at-${toleranceMs}
        AND boundaries.target_at+${toleranceMs}
  ), ranked AS (
    SELECT candidates.*,
      ROW_NUMBER() OVER (
        PARTITION BY period_key,boundary_name
        ORDER BY ABS(observed_at-target_at),source_priority,
          CASE WHEN boundary_name='start' THEN -observed_at ELSE observed_at END,source_id
      ) AS observed_rank,
      ROW_NUMBER() OVER (
        PARTITION BY period_key,boundary_name
        ORDER BY (stream_value IS NULL),ABS(observed_at-target_at),source_priority,
          CASE WHEN boundary_name='start' THEN -observed_at ELSE observed_at END,source_id
      ) AS stream_rank,
      ROW_NUMBER() OVER (
        PARTITION BY period_key,boundary_name
        ORDER BY (member_value IS NULL),ABS(observed_at-target_at),source_priority,
          CASE WHEN boundary_name='start' THEN -observed_at ELSE observed_at END,source_id
      ) AS member_rank
    FROM candidates
  )
  SELECT period_key,
    MAX(CASE WHEN boundary_name='start' AND observed_rank=1 THEN observed_at END) AS boundary_start_at,
    MAX(CASE WHEN boundary_name='end' AND observed_rank=1 THEN observed_at END) AS boundary_end_at,
    MAX(CASE WHEN boundary_name='start' AND stream_rank=1 THEN stream_value END) AS stream_start,
    MAX(CASE WHEN boundary_name='end' AND stream_rank=1 THEN stream_value END) AS stream_end,
    MAX(CASE WHEN boundary_name='start' AND member_rank=1 THEN member_value END) AS member_start,
    MAX(CASE WHEN boundary_name='end' AND member_rank=1 THEN member_value END) AS member_end
  FROM ranked GROUP BY period_key ORDER BY period_key ASC`;
}

export function preaggregatedPeriodBoundaryEvidenceSql() {
  return `WITH periods AS (
    SELECT json_extract(value,'$.period_key') AS period_key
    FROM json_each(?)
  )
  SELECT periods.period_key,
    MAX(CASE WHEN evidence.boundary_name='start' THEN evidence.observed_at END) AS boundary_start_at,
    MAX(CASE WHEN evidence.boundary_name='end' THEN evidence.observed_at END) AS boundary_end_at,
    MAX(CASE WHEN evidence.boundary_name='start' THEN evidence.stream_value END) AS stream_start,
    MAX(CASE WHEN evidence.boundary_name='end' THEN evidence.stream_value END) AS stream_end,
    MAX(CASE WHEN evidence.boundary_name='start' THEN evidence.member_value END) AS member_start,
    MAX(CASE WHEN evidence.boundary_name='end' THEN evidence.member_value END) AS member_end,
    MAX(CASE WHEN evidence.boundary_name='start' THEN 1 ELSE 0 END) AS has_start,
    MAX(CASE WHEN evidence.boundary_name='end' THEN 1 ELSE 0 END) AS has_end
  FROM periods
  LEFT JOIN sh_period_boundary_evidence evidence
    ON evidence.mode=? AND evidence.period_key=periods.period_key
  GROUP BY periods.period_key
  ORDER BY periods.period_key ASC`;
}

export function summaryRowNeedsBoundaryEvidence(row, mode) {
  const periodKey = String(row?.period_key || '');
  const bounds = expectedPeriodBounds(mode, periodKey);
  if (!bounds) return false;
  const toleranceMs = periodBoundaryToleranceMs(mode);
  const start = Object.hasOwn(row || {}, 'boundary_start_at')
    ? row?.boundary_start_at
    : row?.period_start;
  const end = Object.hasOwn(row || {}, 'boundary_end_at')
    ? row?.boundary_end_at
    : row?.period_end;
  if (!withinPeriodBoundaryTolerance(start, bounds.start, toleranceMs)
      || !withinPeriodBoundaryTolerance(end, bounds.end, toleranceMs)) {
    return true;
  }
  const streamReady = finiteNumber(row?.stream_growth) != null
    || (finiteNumber(row?.stream_start) != null && finiteNumber(row?.stream_end) != null);
  const memberReady = finiteNumber(row?.member_growth) != null
    || (finiteNumber(row?.member_start) != null && finiteNumber(row?.member_end) != null);
  return !streamReady || !memberReady;
}

export function rowsRequiringBoundaryEvidence(rows, mode, now = Date.now()) {
  const toleranceMs = periodBoundaryToleranceMs(mode);
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const periodKey = String(row?.period_key || '');
    const bounds = expectedPeriodBounds(mode, periodKey);
    if (!bounds || now < bounds.end + toleranceMs) return false;
    if (mode === 'daily' && KNOWN_DAILY_STREAM_GAPS.has(periodKey)) return false;
    if (mode === 'weekly' && isTrustedEmailWeekly(row)) return false;
    return summaryRowNeedsBoundaryEvidence(row, mode);
  });
}

function periodPayload(rows, mode) {
  const periods = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const periodKey = String(row?.period_key || '');
    if (!periodKey || seen.has(periodKey)) continue;
    const bounds = expectedPeriodBounds(mode, periodKey);
    if (!bounds) continue;
    seen.add(periodKey);
    periods.push({ period_key: periodKey, period_start: bounds.start, period_end: bounds.end });
  }
  return periods;
}

async function loadPreaggregatedEvidence(db, payload, mode) {
  try {
    const result = await db.prepare(preaggregatedPeriodBoundaryEvidenceSql())
      .bind(payload, mode)
      .all();
    return result.results || [];
  } catch (error) {
    if (!/no such table:\s*sh_period_boundary_evidence/i.test(String(error?.message || error))) throw error;
    return [];
  }
}

async function persistLoadedEvidence(db, rows, mode, now = Date.now()) {
  if (!rows.length || typeof db?.batch !== 'function') return;
  const statements = [];
  for (const row of rows) {
    const periodKey = String(row?.period_key || '');
    const bounds = expectedPeriodBounds(mode, periodKey);
    if (!bounds) continue;
    for (const boundaryName of ['start', 'end']) {
      const suffix = boundaryName === 'start' ? 'start' : 'end';
      const observedAt = finiteNumber(row?.[`boundary_${suffix}_at`]);
      if (observedAt == null) continue;
      statements.push(db.prepare(`INSERT INTO sh_period_boundary_evidence (
          mode,period_key,boundary_name,target_at,observed_at,
          stream_observed_at,stream_value,member_observed_at,member_value,
          source_id,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(mode,period_key,boundary_name) DO UPDATE SET
          target_at=excluded.target_at,
          observed_at=excluded.observed_at,
          stream_observed_at=excluded.stream_observed_at,
          stream_value=excluded.stream_value,
          member_observed_at=excluded.member_observed_at,
          member_value=excluded.member_value,
          updated_at=excluded.updated_at`)
        .bind(
          mode,
          periodKey,
          boundaryName,
          boundaryName === 'start' ? bounds.start : bounds.end,
          observedAt,
          finiteNumber(row?.[`stream_${suffix}`]) == null ? null : observedAt,
          finiteNumber(row?.[`stream_${suffix}`]),
          finiteNumber(row?.[`member_${suffix}`]) == null ? null : observedAt,
          finiteNumber(row?.[`member_${suffix}`]),
          null,
          now,
        ));
    }
  }
  if (!statements.length) return;
  try {
    await db.batch(statements);
  } catch (error) {
    if (!/no such table:\s*sh_period_boundary_evidence/i.test(String(error?.message || error))) throw error;
  }
}

export async function loadPeriodBoundaryEvidence(db, rows, mode) {
  const periods = periodPayload(rows, mode);
  if (!periods.length) return new Map();
  const payload = JSON.stringify(periods);
  const preaggregated = await loadPreaggregatedEvidence(db, payload, mode);
  const complete = new Map();
  const missingKeys = new Set(periods.map((period) => period.period_key));
  for (const row of preaggregated) {
    if (Number(row?.has_start) !== 1 || Number(row?.has_end) !== 1) continue;
    const key = String(row.period_key);
    complete.set(key, row);
    missingKeys.delete(key);
  }
  if (!missingKeys.size) return complete;

  const missingPeriods = periods.filter((period) => missingKeys.has(period.period_key));
  const toleranceMs = periodBoundaryToleranceMs(mode);
  let result;
  try {
    result = await db.prepare(periodBoundaryEvidenceSql(toleranceMs))
      .bind(JSON.stringify(missingPeriods))
      .all();
  } catch (error) {
    if (!/no such table|no such column/i.test(String(error?.message || ''))) throw error;
    return complete;
  }
  const loaded = result.results || [];
  await persistLoadedEvidence(db, loaded, mode).catch((error) => {
    console.warn(JSON.stringify({
      event: 'period_boundary_preaggregate_persist_failed',
      mode,
      error: String(error?.message || error).slice(0, 300),
    }));
  });
  for (const row of loaded) complete.set(String(row.period_key), row);
  return complete;
}

export function applyPeriodBoundaryEvidence(rows, evidence) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const periodKey = String(row?.period_key || '');
    if (!evidence?.has(periodKey)) return row;
    const boundary = evidence.get(periodKey) || {};
    const boundaryStart = finiteNumber(boundary.boundary_start_at);
    const boundaryEnd = finiteNumber(boundary.boundary_end_at);
    const streamStart = finiteNumber(boundary.stream_start);
    const streamEnd = finiteNumber(boundary.stream_end);
    const memberStart = finiteNumber(boundary.member_start);
    const memberEnd = finiteNumber(boundary.member_end);
    return {
      ...row,
      period_start: boundaryStart,
      period_end: boundaryEnd,
      boundary_start_at: boundaryStart,
      boundary_end_at: boundaryEnd,
      stream_start: streamStart,
      stream_end: streamEnd,
      stream_growth: streamStart != null && streamEnd != null && streamEnd >= streamStart
        ? streamEnd - streamStart
        : null,
      member_start: memberStart,
      member_end: memberEnd,
      member_growth: memberStart != null && memberEnd != null ? memberEnd - memberStart : null,
    };
  });
}
