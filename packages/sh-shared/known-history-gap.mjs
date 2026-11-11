import {
  currentPeriodKey,
  expectedPeriodBounds,
} from './period-completeness.mjs';

const DAY_MS = 86_400_000;
// Periods with no source observations are represented as explicit missing rows
// in read models and reported as known gaps by materialized-data audits.
export const KNOWN_HISTORY_GAP_RANGES = Object.freeze([
  { start: '2025-09-13', end: '2025-09-23' },
  { start: '2026-01-14', end: '2026-06-22' },
]);

// Keep the original 2026 bounds for the first-week comparison's separate
// collection-window logic; the 2025 gap must not widen that window.
export const KNOWN_HISTORY_GAP_START = '2026-01-14';
export const KNOWN_HISTORY_GAP_END = '2026-06-22';

const GAP_RANGES = KNOWN_HISTORY_GAP_RANGES.map(({ start, end }) => ({
  start: Date.parse(`${start}T00:00:00Z`),
  end: Date.parse(`${end}T00:00:00Z`) + DAY_MS,
}));
const MISSING_VALUE = '-';
const MISSING_FIELDS = [
  'sample_count', 'reliable_sample_count',
  'listener_avg', 'listener_min', 'listener_max',
  'stream_start', 'stream_end', 'stream_growth',
  'member_start', 'member_end', 'member_growth',
  'likes_max', 'distinct_tracks', 'primary_host', 'quality_score',
];

function requestBounds(from, to) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`) + DAY_MS;
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
}

function overlaps(left, right) {
  return Boolean(left && right && left.start < right.end && left.end > right.start);
}

function mondayKey(dateKey) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addMonth(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function isKnownMissingPeriod(mode, periodKey) {
  const bounds = expectedPeriodBounds(mode, periodKey);
  return GAP_RANGES.some((range) => overlaps(bounds, range));
}

export function knownMissingPeriodKeys(mode) {
  const keys = [];
  if (mode === 'daily') {
    for (const range of KNOWN_HISTORY_GAP_RANGES) {
      for (let key = range.start; key <= range.end; key = addDays(key, 1)) keys.push(key);
    }
    return [...new Set(keys)].sort();
  }
  if (mode === 'weekly') {
    for (const range of KNOWN_HISTORY_GAP_RANGES) {
      for (let key = mondayKey(range.start); key <= range.end; key = addDays(key, 7)) keys.push(key);
    }
    return [...new Set(keys)].sort();
  }
  if (mode === 'monthly') {
    for (const range of KNOWN_HISTORY_GAP_RANGES) {
      for (let key = range.start.slice(0, 7); key <= range.end.slice(0, 7); key = addMonth(key)) keys.push(key);
    }
    return [...new Set(keys)].sort();
  }
  return keys;
}

function missingRow(mode, periodKey, existing) {
  const bounds = expectedPeriodBounds(mode, periodKey);
  const row = {
    ...(existing || {}),
    period_key: periodKey,
    period_start: existing?.period_start ?? bounds?.start ?? null,
    period_end: existing?.period_end ?? bounds?.end ?? null,
    known_missing: true,
    synthetic_missing: !existing,
    quality_flags: JSON.stringify(['known_missing_period']),
  };
  for (const field of MISSING_FIELDS) row[field] = MISSING_VALUE;
  return row;
}

export function materializeKnownMissingPeriods(rows, mode, from, to, now = Date.now()) {
  if (!['daily', 'weekly', 'monthly'].includes(mode)) return Array.isArray(rows) ? rows : [];
  const requested = requestBounds(from, to);
  if (!requested) return Array.isArray(rows) ? rows : [];
  const currentKey = currentPeriodKey(mode, now);

  const byKey = new Map((Array.isArray(rows) ? rows : [])
    .map((row) => [String(row?.period_key || ''), row])
    .filter(([key]) => key));

  for (const periodKey of knownMissingPeriodKeys(mode)) {
    if (periodKey >= currentKey) continue;
    const bounds = expectedPeriodBounds(mode, periodKey);
    if (!overlaps(bounds, requested)) continue;
    byKey.set(periodKey, missingRow(mode, periodKey, byKey.get(periodKey)));
  }

  return [...byKey.values()]
    .sort((left, right) => String(left?.period_key || '').localeCompare(String(right?.period_key || '')));
}
