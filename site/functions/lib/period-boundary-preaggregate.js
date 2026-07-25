import {
  currentPeriodKey,
  expectedPeriodBounds,
  periodBoundaryToleranceMs,
} from './period-completeness.js';

const MODES = Object.freeze(['daily', 'weekly', 'monthly']);
const PREAGGREGATE_STEP_MINUTES = 15;
const MINUTE_MS = 60_000;
const UPSERT_SQL = `INSERT INTO sh_period_boundary_evidence (
    mode,period_key,boundary_name,target_at,observed_at,
    stream_observed_at,stream_value,member_observed_at,member_value,
    source_id,updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(mode,period_key,boundary_name) DO UPDATE SET
    target_at=excluded.target_at,
    observed_at=CASE WHEN
      ABS(excluded.observed_at-sh_period_boundary_evidence.target_at)
        < ABS(sh_period_boundary_evidence.observed_at-sh_period_boundary_evidence.target_at)
      OR (
        ABS(excluded.observed_at-sh_period_boundary_evidence.target_at)
          = ABS(sh_period_boundary_evidence.observed_at-sh_period_boundary_evidence.target_at)
        AND (
          (excluded.boundary_name='start' AND excluded.observed_at>sh_period_boundary_evidence.observed_at)
          OR (excluded.boundary_name='end' AND excluded.observed_at<sh_period_boundary_evidence.observed_at)
        )
      ) THEN excluded.observed_at ELSE sh_period_boundary_evidence.observed_at END,
    stream_observed_at=CASE WHEN excluded.stream_value IS NOT NULL AND (
      sh_period_boundary_evidence.stream_value IS NULL
      OR ABS(excluded.stream_observed_at-sh_period_boundary_evidence.target_at)
        < ABS(sh_period_boundary_evidence.stream_observed_at-sh_period_boundary_evidence.target_at)
      OR (
        ABS(excluded.stream_observed_at-sh_period_boundary_evidence.target_at)
          = ABS(sh_period_boundary_evidence.stream_observed_at-sh_period_boundary_evidence.target_at)
        AND (
          (excluded.boundary_name='start' AND excluded.stream_observed_at>sh_period_boundary_evidence.stream_observed_at)
          OR (excluded.boundary_name='end' AND excluded.stream_observed_at<sh_period_boundary_evidence.stream_observed_at)
        )
      )
    ) THEN excluded.stream_observed_at ELSE sh_period_boundary_evidence.stream_observed_at END,
    stream_value=CASE WHEN excluded.stream_value IS NOT NULL AND (
      sh_period_boundary_evidence.stream_value IS NULL
      OR ABS(excluded.stream_observed_at-sh_period_boundary_evidence.target_at)
        < ABS(sh_period_boundary_evidence.stream_observed_at-sh_period_boundary_evidence.target_at)
      OR (
        ABS(excluded.stream_observed_at-sh_period_boundary_evidence.target_at)
          = ABS(sh_period_boundary_evidence.stream_observed_at-sh_period_boundary_evidence.target_at)
        AND (
          (excluded.boundary_name='start' AND excluded.stream_observed_at>sh_period_boundary_evidence.stream_observed_at)
          OR (excluded.boundary_name='end' AND excluded.stream_observed_at<sh_period_boundary_evidence.stream_observed_at)
        )
      )
    ) THEN excluded.stream_value ELSE sh_period_boundary_evidence.stream_value END,
    member_observed_at=CASE WHEN excluded.member_value IS NOT NULL AND (
      sh_period_boundary_evidence.member_value IS NULL
      OR ABS(excluded.member_observed_at-sh_period_boundary_evidence.target_at)
        < ABS(sh_period_boundary_evidence.member_observed_at-sh_period_boundary_evidence.target_at)
      OR (
        ABS(excluded.member_observed_at-sh_period_boundary_evidence.target_at)
          = ABS(sh_period_boundary_evidence.member_observed_at-sh_period_boundary_evidence.target_at)
        AND (
          (excluded.boundary_name='start' AND excluded.member_observed_at>sh_period_boundary_evidence.member_observed_at)
          OR (excluded.boundary_name='end' AND excluded.member_observed_at<sh_period_boundary_evidence.member_observed_at)
        )
      )
    ) THEN excluded.member_observed_at ELSE sh_period_boundary_evidence.member_observed_at END,
    member_value=CASE WHEN excluded.member_value IS NOT NULL AND (
      sh_period_boundary_evidence.member_value IS NULL
      OR ABS(excluded.member_observed_at-sh_period_boundary_evidence.target_at)
        < ABS(sh_period_boundary_evidence.member_observed_at-sh_period_boundary_evidence.target_at)
      OR (
        ABS(excluded.member_observed_at-sh_period_boundary_evidence.target_at)
          = ABS(sh_period_boundary_evidence.member_observed_at-sh_period_boundary_evidence.target_at)
        AND (
          (excluded.boundary_name='start' AND excluded.member_observed_at>sh_period_boundary_evidence.member_observed_at)
          OR (excluded.boundary_name='end' AND excluded.member_observed_at<sh_period_boundary_evidence.member_observed_at)
        )
      )
    ) THEN excluded.member_value ELSE sh_period_boundary_evidence.member_value END,
    source_id=CASE WHEN excluded.observed_at=sh_period_boundary_evidence.observed_at THEN excluded.source_id ELSE sh_period_boundary_evidence.source_id END,
    updated_at=excluded.updated_at
  WHERE
    ABS(excluded.observed_at-sh_period_boundary_evidence.target_at)
      < ABS(sh_period_boundary_evidence.observed_at-sh_period_boundary_evidence.target_at)
    OR (
      ABS(excluded.observed_at-sh_period_boundary_evidence.target_at)
        = ABS(sh_period_boundary_evidence.observed_at-sh_period_boundary_evidence.target_at)
      AND (
        (excluded.boundary_name='start' AND excluded.observed_at>sh_period_boundary_evidence.observed_at)
        OR (excluded.boundary_name='end' AND excluded.observed_at<sh_period_boundary_evidence.observed_at)
      )
    )
    OR (excluded.stream_value IS NOT NULL AND (
      sh_period_boundary_evidence.stream_value IS NULL
      OR ABS(excluded.stream_observed_at-sh_period_boundary_evidence.target_at)
        < ABS(sh_period_boundary_evidence.stream_observed_at-sh_period_boundary_evidence.target_at)
      OR (
        ABS(excluded.stream_observed_at-sh_period_boundary_evidence.target_at)
          = ABS(sh_period_boundary_evidence.stream_observed_at-sh_period_boundary_evidence.target_at)
        AND (
          (excluded.boundary_name='start' AND excluded.stream_observed_at>sh_period_boundary_evidence.stream_observed_at)
          OR (excluded.boundary_name='end' AND excluded.stream_observed_at<sh_period_boundary_evidence.stream_observed_at)
        )
      )
    ))
    OR (excluded.member_value IS NOT NULL AND (
      sh_period_boundary_evidence.member_value IS NULL
      OR ABS(excluded.member_observed_at-sh_period_boundary_evidence.target_at)
        < ABS(sh_period_boundary_evidence.member_observed_at-sh_period_boundary_evidence.target_at)
      OR (
        ABS(excluded.member_observed_at-sh_period_boundary_evidence.target_at)
          = ABS(sh_period_boundary_evidence.member_observed_at-sh_period_boundary_evidence.target_at)
        AND (
          (excluded.boundary_name='start' AND excluded.member_observed_at>sh_period_boundary_evidence.member_observed_at)
          OR (excluded.boundary_name='end' AND excluded.member_observed_at<sh_period_boundary_evidence.member_observed_at)
        )
      )
    ))`;

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function previousPeriodKey(mode, key) {
  const bounds = expectedPeriodBounds(mode, key);
  if (!bounds) return null;
  const before = bounds.start - 1;
  return currentPeriodKey(mode, before);
}

export function periodBoundaryCandidates(observedAt) {
  const observed = finite(observedAt);
  if (observed == null || observed < 0) return [];
  const candidates = [];
  for (const mode of MODES) {
    const current = currentPeriodKey(mode, observed);
    const keys = new Set([current, previousPeriodKey(mode, current)]);
    const tolerance = periodBoundaryToleranceMs(mode);
    for (const periodKey of keys) {
      const bounds = expectedPeriodBounds(mode, periodKey);
      if (!bounds) continue;
      for (const [boundaryName, targetAt] of [['start', bounds.start], ['end', bounds.end]]) {
        const distance = Math.abs(observed - targetAt);
        const aligned = Math.floor(observed / MINUTE_MS) % PREAGGREGATE_STEP_MINUTES === 0;
        if (distance <= tolerance && (distance === 0 || aligned)) {
          candidates.push({ mode, period_key: periodKey, boundary_name: boundaryName, target_at: targetAt });
        }
      }
    }
  }
  return candidates;
}

export async function savePeriodBoundaryEvidence(db, observedAt, data = {}) {
  if (!db?.prepare) return { written: 0, skipped: true, reason: 'db-missing' };
  const observed = finite(observedAt);
  const candidates = periodBoundaryCandidates(observed);
  if (!candidates.length) return { written: 0, skipped: true, reason: 'outside-boundary-window' };
  const streamValue = finite(data?.current_stream_count) ?? finite(data?.total_listens);
  const memberValue = finite(data?.total_member_count);
  const sourceId = finite(data?.id) ?? finite(data?.snapshot_id);
  const statements = candidates.map((candidate) => db.prepare(UPSERT_SQL).bind(
    candidate.mode,
    candidate.period_key,
    candidate.boundary_name,
    candidate.target_at,
    observed,
    streamValue == null ? null : observed,
    streamValue,
    memberValue == null ? null : observed,
    memberValue,
    sourceId,
    Date.now(),
  ));
  try {
    const results = typeof db.batch === 'function'
      ? await db.batch(statements)
      : await Promise.all(statements.map((statement) => statement.run()));
    return {
      written: results.reduce((total, result) => total + Number(result?.meta?.changes || 0), 0),
      candidates: candidates.length,
      skipped: false,
    };
  } catch (error) {
    if (/no such table:\s*sh_period_boundary_evidence/i.test(String(error?.message || error))) {
      return { written: 0, skipped: true, reason: 'migration-pending' };
    }
    throw error;
  }
}
