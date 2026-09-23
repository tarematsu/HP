import { expectedPeriodBounds } from './period-completeness.js';

const DAY_MS = 86_400_000;
export const KNOWN_HISTORY_GAP_START = '2026-01-14';
export const KNOWN_HISTORY_GAP_END = '2026-06-22';

const GAP_START_MS = Date.parse(`${KNOWN_HISTORY_GAP_START}T00:00:00Z`);
const GAP_END_EXCLUSIVE_MS = Date.parse(`${KNOWN_HISTORY_GAP_END}T00:00:00Z`) + DAY_MS;
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
  return overlaps(bounds, { start: GAP_START_MS, end: GAP_END_EXCLUSIVE_MS });
}

export function knownMissingPeriodKeys(mode) {
  const keys = [];
  if (mode === 'daily') {
    for (let key = KNOWN_HISTORY_GAP_START; key <= KNOWN_HISTORY_GAP_END; key = addDays(key, 1)) keys.push(key);
    return keys;
  }
  if (mode === 'weekly') {
    for (let key = mondayKey(KNOWN_HISTORY_GAP_START); key <= KNOWN_HISTORY_GAP_END; key = addDays(key, 7)) keys.push(key);
    return keys;
  }
  if (mode === 'monthly') {
    for (let key = KNOWN_HISTORY_GAP_START.slice(0, 7); key <= KNOWN_HISTORY_GAP_END.slice(0, 7); key = addMonth(key)) keys.push(key);
    return keys;
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

export function materializeKnownMissingPeriods(rows, mode, from, to) {
  if (!['daily', 'weekly', 'monthly'].includes(mode)) return Array.isArray(rows) ? rows : [];
  const requested = requestBounds(from, to);
  if (!requested) return Array.isArray(rows) ? rows : [];

  const byKey = new Map((Array.isArray(rows) ? rows : [])
    .map((row) => [String(row?.period_key || ''), row])
    .filter(([key]) => key));

  for (const periodKey of knownMissingPeriodKeys(mode)) {
    const bounds = expectedPeriodBounds(mode, periodKey);
    if (!overlaps(bounds, requested)) continue;
    byKey.set(periodKey, missingRow(mode, periodKey, byKey.get(periodKey)));
  }

  return [...byKey.values()]
    .sort((left, right) => String(left?.period_key || '').localeCompare(String(right?.period_key || '')));
}
