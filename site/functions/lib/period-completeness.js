import { isRealIsoDate } from './api-utils.js';

const DAY_MS = 86400000;
const MINUTE_MS = 60000;

export const DAILY_BOUNDARY_TOLERANCE_MS = 15 * MINUTE_MS;
export const WEEKLY_BOUNDARY_TOLERANCE_MS = 7 * DAY_MS * 0.05;
export const MONTHLY_BOUNDARY_TOLERANCE_MS = 30 * DAY_MS * 0.05;
export const PERIOD_BOUNDARY_TOLERANCE_MS = DAILY_BOUNDARY_TOLERANCE_MS;
export const DAILY_EXPECTED_SAMPLE_COUNT = 1440;
export const DAILY_MINIMUM_SAMPLE_COUNT = 1;
export const SUMMARY_MINIMUM_DAILY_SAMPLES = 24;
export const SUMMARY_DAILY_BOUNDARY_TOLERANCE_MS = 60 * MINUTE_MS;
export const SUMMARY_BOUNDARY_TOLERANCE_RATIO = 0.05;
export const WEEKLY_MEMBER_BOUNDARY_TOLERANCE_MS = DAY_MS;
export const MONTHLY_MEMBER_BOUNDARY_TOLERANCE_MS = 3 * DAY_MS;
export const KNOWN_DAILY_STREAM_GAPS = new Set(['2026-04-30']);

const EMAIL_WEEKLY_FROM = '2026-01-01';
const EMAIL_WEEKLY_TO_EXCLUSIVE = '2026-07-01';
const SUMMARY_COLLECTION_INTERVALS_MS = [MINUTE_MS, 5 * MINUTE_MS];

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validDate(value) {
  return isRealIsoDate(value);
}

function validMonth(value) {
  const text = String(value || '');
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text);
}

export function periodBoundaryToleranceMs(mode, periodKey = null) {
  if (mode === 'weekly') return WEEKLY_BOUNDARY_TOLERANCE_MS;
  if (mode === 'monthly') {
    const bounds = periodKey ? expectedPeriodBounds(mode, periodKey) : null;
    return bounds ? (bounds.end - bounds.start) * SUMMARY_BOUNDARY_TOLERANCE_RATIO : MONTHLY_BOUNDARY_TOLERANCE_MS;
  }
  return DAILY_BOUNDARY_TOLERANCE_MS;
}

export function memberBoundaryToleranceMs(mode) {
  if (mode === 'weekly') return WEEKLY_MEMBER_BOUNDARY_TOLERANCE_MS;
  if (mode === 'monthly') return MONTHLY_MEMBER_BOUNDARY_TOLERANCE_MS;
  return DAY_MS;
}

export function parseQualityFlags(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {}
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function appendFlags(value, flags) {
  const merged = new Set(parseQualityFlags(value));
  for (const flag of flags) merged.add(flag);
  return JSON.stringify([...merged]);
}

function nextMonthKey(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function expectedPeriodBounds(mode, periodKey) {
  if (mode === 'daily') {
    if (!validDate(periodKey)) return null;
    const start = Date.parse(`${periodKey}T00:00:00Z`);
    return Number.isFinite(start) ? { start, end: start + DAY_MS } : null;
  }
  if (mode === 'weekly') {
    if (!validDate(periodKey)) return null;
    const start = Date.parse(`${periodKey}T00:00:00Z`);
    return Number.isFinite(start) ? { start, end: start + 7 * DAY_MS } : null;
  }
  if (mode === 'monthly') {
    const monthKey = validMonth(periodKey)
      ? periodKey
      : validDate(periodKey) ? String(periodKey).slice(0, 7) : null;
    if (!monthKey) return null;
    const start = Date.parse(`${monthKey}-01T00:00:00Z`);
    const end = Date.parse(`${nextMonthKey(monthKey)}-01T00:00:00Z`);
    return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
  }
  return null;
}

export function parseRangeStart(mode, value, fallback) {
  const text = validDate(value) ? value : fallback;
  if (!validDate(text)) return NaN;
  return Date.parse(`${text}T00:00:00Z`);
}

export function currentPeriodKey(mode, now = Date.now()) {
  const current = new Date(now);
  const year = current.getUTCFullYear();
  const month = current.getUTCMonth() + 1;
  const day = current.getUTCDate();
  if (mode === 'daily') return current.toISOString().slice(0, 10);
  if (mode === 'monthly') return `${year}-${String(month).padStart(2, '0')}`;
  const monday = new Date(Date.UTC(year, month - 1, day));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

export function isTrustedEmailWeekly(row) {
  const periodKey = String(row?.period_key || '');
  return periodKey >= EMAIL_WEEKLY_FROM && periodKey < EMAIL_WEEKLY_TO_EXCLUSIVE;
}

export function withinPeriodBoundaryTolerance(observedAt, boundaryAt, toleranceMs = DAILY_BOUNDARY_TOLERANCE_MS) {
  const observed = finiteNumber(observedAt);
  const boundary = finiteNumber(boundaryAt);
  return observed != null && boundary != null && Math.abs(observed - boundary) <= toleranceMs;
}

export function evaluatePeriodCompleteness({
  mode,
  periodKey,
  firstObservedAt,
  lastObservedAt,
  sampleCount,
  qualityFlags,
  now = Date.now(),
  toleranceMs,
  knownGap = false,
}) {
  const bounds = expectedPeriodBounds(mode, periodKey);
  if (!bounds) return { complete: false, trusted: false, reasons: ['invalid_period_key'], bounds: null };

  const suppliedTolerance = finiteNumber(toleranceMs);
  const effectiveToleranceMs = suppliedTolerance == null
    ? periodBoundaryToleranceMs(mode, periodKey)
    : Math.max(0, suppliedTolerance);
  const current = now < bounds.end + effectiveToleranceMs;
  const trusted = mode === 'weekly' && isTrustedEmailWeekly({ period_key: periodKey, quality_flags: qualityFlags });
  if (trusted && !current) return { complete: true, trusted: true, reasons: [], bounds };

  const reasons = [];
  if (current) reasons.push('current_period');
  if (knownGap) reasons.push('known_collection_gap');
  const samples = finiteNumber(sampleCount);
  if (mode === 'daily' && samples != null) {
    if (samples < DAILY_MINIMUM_SAMPLE_COUNT) reasons.push('insufficient_samples');
    if (samples > DAILY_EXPECTED_SAMPLE_COUNT) reasons.push('excess_samples');
  }
  if (!withinPeriodBoundaryTolerance(firstObservedAt, bounds.start, effectiveToleranceMs)) reasons.push('missing_period_start');
  if (!withinPeriodBoundaryTolerance(lastObservedAt, bounds.end, effectiveToleranceMs)) reasons.push('missing_period_end');
  return { complete: reasons.length === 0, trusted: false, reasons, bounds };
}

function qualityFlagsForReasons(reasons) {
  const flags = [];
  if (reasons.includes('current_period')) flags.push('incomplete_current_period');
  if (reasons.includes('known_collection_gap')) flags.push('known_collection_gap');
  if (reasons.includes('insufficient_samples')) flags.push('incomplete_sample_count');
  if (reasons.includes('excess_samples')) flags.push('excess_sample_count');
  if (reasons.includes('missing_period_start')) flags.push('incomplete_period_start');
  if (reasons.includes('missing_period_end')) flags.push('incomplete_period_end');
  if (reasons.includes('invalid_period_key')) flags.push('invalid_period_key');
  if (reasons.includes('missing_daily_coverage')) flags.push('incomplete_daily_coverage');
  if (reasons.includes('missing_daily_stream_boundary')) flags.push('incomplete_daily_stream_boundary');
  if (reasons.includes('missing_summary_stream_boundary')) flags.push('incomplete_summary_stream_boundary');
  if (reasons.includes('insufficient_daily_samples')) flags.push('incomplete_daily_samples');
  if (reasons.includes('missing_listener_average')) flags.push('missing_listener_average');
  if (reasons.includes('missing_summary_stream_start')) flags.push('incomplete_summary_stream_start');
  if (reasons.includes('missing_summary_stream_end')) flags.push('incomplete_summary_stream_end');
  if (reasons.includes('invalid_summary_stream_order')) flags.push('invalid_summary_stream_order');
  if (reasons.includes('missing_summary_member_start')) flags.push('incomplete_summary_member_start');
  if (reasons.includes('missing_summary_member_end')) flags.push('incomplete_summary_member_end');
  return flags;
}

export async function loadSummaryDailyCoverage(db, rows, mode) {
  if (mode === 'daily' || !rows?.length) return null;
  const bounds = rows.map((row) => expectedPeriodBounds(mode, row?.period_key)).filter(Boolean);
  if (!bounds.length) return [];
  const margin = memberBoundaryToleranceMs(mode);
  const start = Math.min(...bounds.map((period) => period.start)) - margin;
  const end = Math.max(...bounds.map((period) => period.end)) + margin + DAY_MS;
  const from = new Date(start).toISOString().slice(0, 10);
  const to = new Date(end).toISOString().slice(0, 10);
  const result = await db.prepare(`SELECT period_key,period_start,period_end,
      sample_count,reliable_sample_count,stream_start,stream_end,member_start,member_end
    FROM sh_daily_summary WHERE period_key>=? AND period_key<?
    ORDER BY period_key ASC LIMIT 2000`).bind(from, to).all();
  return result.results || [];
}

function inferCollectionIntervalMs(day) {
  const samples = finiteNumber(day?.sample_count) ?? finiteNumber(day?.reliable_sample_count);
  if (samples == null || samples <= 0) return MINUTE_MS;
  const first = finiteNumber(day?.period_start);
  const last = finiteNumber(day?.period_end);
  const span = first != null && last != null && last >= first ? Math.min(DAY_MS, last - first) : DAY_MS;
  let best = SUMMARY_COLLECTION_INTERVALS_MS[0];
  let bestScore = Infinity;
  for (const interval of SUMMARY_COLLECTION_INTERVALS_MS) {
    const expected = Math.max(1, Math.floor(span / interval) + 1);
    const score = Math.abs(samples - expected) / expected;
    if (score < bestScore) {
      best = interval;
      bestScore = score;
    }
  }
  return best;
}

function dailyListenerCoverage(day, dayAt) {
  if (!day) return 0;
  const samples = finiteNumber(day?.reliable_sample_count) ?? finiteNumber(day?.sample_count);
  if (samples == null || samples <= 0) return 0;
  const interval = inferCollectionIntervalMs(day);
  const first = finiteNumber(day?.period_start);
  const last = finiteNumber(day?.period_end);
  if (first == null || last == null || last < first) {
    return Math.min(1, samples / Math.max(1, DAY_MS / interval));
  }
  const start = Math.max(dayAt, Math.min(dayAt + DAY_MS, first));
  const end = Math.max(dayAt, Math.min(dayAt + DAY_MS, last));
  const span = Math.max(0, end - start);
  const timeCoverage = Math.min(1, span > 0 ? span / DAY_MS : interval / DAY_MS);
  const expectedWithinSpan = Math.max(1, Math.floor(span / interval) + 1);
  const density = Math.min(1, samples / expectedWithinSpan);
  return Math.min(1, timeCoverage * density);
}

function summaryListenerCoverage(row, mode, dailyRows) {
  if (!Array.isArray(dailyRows)) return null;
  const bounds = expectedPeriodBounds(mode, row?.period_key);
  if (!bounds) return { ratio: 0, expectedDays: 0, missingDays: 0, sparseDays: 0 };
  const byDay = new Map(dailyRows.map((day) => [String(day?.period_key || ''), day]));
  let coverage = 0;
  let expectedDays = 0;
  let missingDays = 0;
  let sparseDays = 0;
  for (let dayAt = bounds.start; dayAt < bounds.end; dayAt += DAY_MS) {
    expectedDays += 1;
    const key = new Date(dayAt).toISOString().slice(0, 10);
    const day = byDay.get(key);
    if (!day) {
      missingDays += 1;
      continue;
    }
    const dayCoverage = dailyListenerCoverage(day, dayAt);
    coverage += dayCoverage;
    if (dayCoverage < 0.5) sparseDays += 1;
  }
  return {
    ratio: expectedDays ? coverage / expectedDays : 0,
    expectedDays,
    missingDays,
    sparseDays,
  };
}

function nearestDailyMemberBoundary(dailyRows, targetAt, toleranceMs) {
  if (!Array.isArray(dailyRows)) return null;
  let best = null;
  for (const day of dailyRows) {
    const key = String(day?.period_key || '');
    if (!validDate(key)) continue;
    const dayStart = Date.parse(`${key}T00:00:00Z`);
    const candidates = [
      { value: finiteNumber(day?.member_start), observedAt: dayStart },
      { value: finiteNumber(day?.member_end), observedAt: dayStart + DAY_MS },
    ];
    for (const candidate of candidates) {
      if (candidate.value == null) continue;
      const distance = Math.abs(candidate.observedAt - targetAt);
      if (distance > toleranceMs) continue;
      if (!best || distance < best.distance) best = { ...candidate, distance };
    }
  }
  return best;
}

function resolveMemberBoundary(row, dailyRows, field, fallbackAt, targetAt, toleranceMs) {
  const fallbackValue = finiteNumber(row?.[field]);
  if (fallbackValue != null && withinPeriodBoundaryTolerance(fallbackAt, targetAt, toleranceMs)) {
    return { value: fallbackValue, observedAt: finiteNumber(fallbackAt) };
  }
  return nearestDailyMemberBoundary(dailyRows, targetAt, toleranceMs);
}

function summaryMetricAssessment(row, mode, dailyRows) {
  const bounds = expectedPeriodBounds(mode, row?.period_key);
  if (!bounds) return null;
  const tolerance = (bounds.end - bounds.start) * SUMMARY_BOUNDARY_TOLERANCE_RATIO;
  const memberTolerance = memberBoundaryToleranceMs(mode);
  const hasBoundaryStart = Object.hasOwn(row || {}, 'boundary_start_at');
  const hasBoundaryEnd = Object.hasOwn(row || {}, 'boundary_end_at');
  const startAt = hasBoundaryStart ? row?.boundary_start_at : row?.period_start;
  const endAt = hasBoundaryEnd ? row?.boundary_end_at : row?.period_end;
  const startNear = withinPeriodBoundaryTolerance(startAt, bounds.start, tolerance);
  const endNear = withinPeriodBoundaryTolerance(endAt, bounds.end, tolerance);
  const listenerCoverage = summaryListenerCoverage(row, mode, dailyRows);
  const listenerAverageReady = finiteNumber(row?.listener_avg) != null;
  const streamStart = finiteNumber(row?.stream_start);
  const streamEnd = finiteNumber(row?.stream_end);
  const memberStartBoundary = resolveMemberBoundary(
    row, dailyRows, 'member_start', startAt, bounds.start, memberTolerance,
  );
  const memberEndBoundary = resolveMemberBoundary(
    row, dailyRows, 'member_end', endAt, bounds.end, memberTolerance,
  );
  const streamStartReady = startNear && streamStart != null && streamStart > 0;
  const streamEndReady = endNear && streamEnd != null && streamEnd > 0;
  const memberStartReady = memberStartBoundary != null;
  const memberEndReady = memberEndBoundary != null;
  const streamOrderValid = !streamStartReady || !streamEndReady || streamEnd >= streamStart;
  const reasons = [];
  if (listenerCoverage?.missingDays) reasons.push('missing_daily_coverage');
  if (listenerCoverage?.sparseDays) reasons.push('insufficient_daily_samples');
  if (!listenerAverageReady) reasons.push('missing_listener_average');
  if (!streamStartReady) reasons.push('missing_summary_stream_start');
  if (!streamEndReady) reasons.push('missing_summary_stream_end');
  if (!streamOrderValid) reasons.push('invalid_summary_stream_order');
  if (!memberStartReady) reasons.push('missing_summary_member_start');
  if (!memberEndReady) reasons.push('missing_summary_member_end');
  return {
    listenerCoverage,
    listenerAverageReady,
    streamStartReady,
    streamEndReady,
    memberStartReady,
    memberEndReady,
    memberStart: memberStartBoundary?.value ?? null,
    memberEnd: memberEndBoundary?.value ?? null,
    memberStartAt: memberStartBoundary?.observedAt ?? null,
    memberEndAt: memberEndBoundary?.observedAt ?? null,
    streamOrderValid,
    reasons,
  };
}

export function summaryDailyCoverageReasons(row, mode, dailyRows) {
  if (mode === 'daily' || !Array.isArray(dailyRows)) return [];
  if (mode === 'weekly' && isTrustedEmailWeekly(row)
      && parseQualityFlags(row?.quality_flags).includes('stationhead_email_recap')) return [];
  return summaryMetricAssessment(row, mode, dailyRows)?.reasons || [];
}

function isBoundaryOnlyIncomplete(reasons) {
  return reasons.length > 0 && reasons.every((reason) => (
    reason === 'missing_period_start' || reason === 'missing_period_end'
  ));
}

function dailyMemberMetrics(row) {
  const memberStart = finiteNumber(row?.member_start);
  const memberEnd = finiteNumber(row?.member_end);
  const ready = memberStart != null && memberEnd != null;
  return {
    memberStart,
    memberEnd,
    memberGrowth: ready ? memberEnd - memberStart : null,
    ready,
  };
}

function applyDailyCompleteness(row, evaluation) {
  const reasons = evaluation.reasons;
  const member = dailyMemberMetrics(row);
  const normalizedRow = {
    ...row,
    member_start: member.memberStart,
    member_end: member.memberEnd,
    member_growth: member.memberGrowth,
    member_growth_excluded: !member.ready,
  };
  if (!reasons.length) {
    return {
      row: {
        ...normalizedRow,
        period_complete: true,
        listener_metrics_excluded: false,
        stream_growth_excluded: false,
        exclusion_reasons: [],
      },
      excluded: false,
    };
  }
  const qualityFlags = appendFlags(row?.quality_flags, qualityFlagsForReasons(reasons));
  if (isBoundaryOnlyIncomplete(reasons)) {
    return {
      row: {
        ...normalizedRow,
        period_complete: false,
        listener_metrics_excluded: false,
        stream_growth_excluded: false,
        exclusion_reasons: reasons,
        quality_flags: qualityFlags,
      },
      excluded: false,
    };
  }
  return {
    row: {
      ...normalizedRow,
      listener_avg: null,
      listener_min: null,
      listener_max: null,
      stream_growth: null,
      member_growth: null,
      period_complete: false,
      listener_metrics_excluded: true,
      stream_growth_excluded: true,
      member_growth_excluded: true,
      exclusion_reasons: reasons,
      quality_flags: qualityFlags,
    },
    excluded: true,
  };
}

export function applySummaryCompleteness(rows, mode, now = Date.now(), dailyCoverage = null) {
  let excludedCount = 0;
  const completedRows = (Array.isArray(rows) ? rows : []).map((row) => {
    const periodKey = String(row?.period_key || '');
    const hasBoundaryStart = Object.hasOwn(row || {}, 'boundary_start_at');
    const hasBoundaryEnd = Object.hasOwn(row || {}, 'boundary_end_at');
    const evaluation = evaluatePeriodCompleteness({
      mode,
      periodKey,
      firstObservedAt: hasBoundaryStart ? row?.boundary_start_at : row?.period_start,
      lastObservedAt: hasBoundaryEnd ? row?.boundary_end_at : row?.period_end,
      sampleCount: row?.sample_count,
      qualityFlags: row?.quality_flags,
      now,
      knownGap: mode === 'daily' && KNOWN_DAILY_STREAM_GAPS.has(periodKey),
    });

    if (mode === 'daily') {
      const result = applyDailyCompleteness(row, evaluation);
      if (result.excluded) excludedCount += 1;
      return result.row;
    }
    if (evaluation.trusted && evaluation.complete) {
      return {
        ...row,
        period_complete: true,
        listener_metrics_excluded: false,
        listener_average_excluded: false,
        stream_growth_excluded: false,
        member_growth_excluded: false,
        exclusion_reasons: [],
      };
    }

    const hardIncomplete = evaluation.reasons.includes('current_period')
      || evaluation.reasons.includes('invalid_period_key');
    const assessment = summaryMetricAssessment(row, mode, dailyCoverage);
    if (!assessment || hardIncomplete) {
      const reasons = [...new Set([...evaluation.reasons, ...(assessment?.reasons || [])])];
      excludedCount += 1;
      return {
        ...row,
        listener_avg: null,
        listener_min: null,
        listener_max: null,
        stream_start: null,
        stream_end: null,
        member_start: null,
        member_end: null,
        stream_growth: null,
        member_growth: null,
        period_complete: false,
        listener_metrics_excluded: true,
        listener_average_excluded: true,
        stream_growth_excluded: true,
        member_growth_excluded: true,
        exclusion_reasons: reasons,
        quality_flags: appendFlags(row?.quality_flags, qualityFlagsForReasons(reasons)),
      };
    }

    const streamStart = finiteNumber(row?.stream_start);
    const streamEnd = finiteNumber(row?.stream_end);
    const memberStart = assessment.memberStart;
    const memberEnd = assessment.memberEnd;
    const streamGrowthReady = assessment.streamStartReady && assessment.streamEndReady && assessment.streamOrderValid;
    const memberGrowthReady = assessment.memberStartReady && assessment.memberEndReady;
    const reasons = [...new Set([...evaluation.reasons, ...assessment.reasons])];
    const periodComplete = reasons.length === 0;
    const listenerMin = finiteNumber(row?.listener_min);
    const listenerMax = finiteNumber(row?.listener_max);
    const anyExcluded = !assessment.listenerAverageReady || !streamGrowthReady || !memberGrowthReady;
    if (anyExcluded || !periodComplete) excludedCount += 1;

    return {
      ...row,
      listener_avg: assessment.listenerAverageReady ? row?.listener_avg : null,
      listener_min: listenerMin == null ? null : row?.listener_min,
      listener_max: listenerMax == null ? null : row?.listener_max,
      stream_start: assessment.streamStartReady ? row?.stream_start : null,
      stream_end: assessment.streamEndReady ? row?.stream_end : null,
      member_start: assessment.memberStartReady ? memberStart : null,
      member_end: assessment.memberEndReady ? memberEnd : null,
      stream_growth: streamGrowthReady ? streamEnd - streamStart : null,
      member_growth: memberGrowthReady ? memberEnd - memberStart : null,
      period_complete: periodComplete,
      listener_metrics_excluded: !assessment.listenerAverageReady,
      listener_average_excluded: !assessment.listenerAverageReady,
      stream_growth_excluded: !streamGrowthReady,
      member_growth_excluded: !memberGrowthReady,
      listener_coverage_ratio: assessment.listenerCoverage?.ratio ?? null,
      exclusion_reasons: reasons,
      quality_flags: appendFlags(row?.quality_flags, qualityFlagsForReasons(reasons)),
    };
  });
  return { rows: completedRows, excludedCount };
}

export function applyTrackPeriodCompleteness(rows, coverageRows, now = Date.now()) {
  const coverage = new Map();
  for (const row of Array.isArray(coverageRows) ? coverageRows : []) {
    const key = String(row?.play_date || '');
    if (!key) continue;
    const first = finiteNumber(row?.period_first_observed_at);
    const last = finiteNumber(row?.period_last_observed_at);
    const current = coverage.get(key) || { first: null, last: null };
    if (first != null) current.first = current.first == null ? first : Math.min(current.first, first);
    if (last != null) current.last = current.last == null ? last : Math.max(current.last, last);
    coverage.set(key, current);
  }

  const evaluations = new Map();
  const excludedDates = new Set();
  const completedRows = (Array.isArray(rows) ? rows : []).map((row) => {
    const periodKey = String(row?.play_date || '');
    let evaluation = evaluations.get(periodKey);
    if (!evaluation) {
      const evidence = coverage.get(periodKey) || {};
      evaluation = evaluatePeriodCompleteness({
        mode: 'daily',
        periodKey,
        firstObservedAt: evidence.first,
        lastObservedAt: evidence.last,
        now,
      });
      evaluations.set(periodKey, evaluation);
    }
    if (!evaluation.complete) excludedDates.add(periodKey);
    return {
      ...row,
      period_complete: evaluation.complete,
      play_count_excluded: !evaluation.complete,
      exclusion_reasons: evaluation.reasons,
    };
  });
  return { rows: completedRows, excludedDates: [...excludedDates].sort() };
}