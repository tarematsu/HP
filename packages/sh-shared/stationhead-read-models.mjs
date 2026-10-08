import { STATIONHEAD_SOURCE_PROFILES, stationheadSourceProfile } from './stationhead-source.mjs';

const DAY_MS = 24 * 60 * 60_000;
const FIVE_MINUTES_MS = 5 * 60_000;

export const STATIONHEAD_READ_MODEL_INCREMENTAL_GAP_MS = 11 * 60_000;
export const STATIONHEAD_READ_MODEL_RECOVERY_GAP_MS = DAY_MS;

export const STATIONHEAD_READ_MODEL_KEYS = Object.freeze(Object.fromEntries(
  Object.entries(STATIONHEAD_SOURCE_PROFILES).map(([source, profile]) => [source, profile.modelKey]),
));

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integer(value) {
  const number = finite(value);
  return number == null ? null : Math.trunc(number);
}

function dayStart(timestamp) {
  return Math.floor(Number(timestamp) / DAY_MS) * DAY_MS;
}

function periodKey(timestamp) {
  return new Date(dayStart(timestamp)).toISOString().slice(0, 10);
}

function weekStart(timestamp) {
  const start = dayStart(timestamp);
  const date = new Date(start);
  return start - ((date.getUTCDay() + 6) % 7) * DAY_MS;
}

// Shared UTC boundaries for source-scoped daily/weekly rollups.
export { dayStart as stationheadUtcDayStart, periodKey as stationheadUtcDayKey };
export function stationheadUtcWeekKey(timestamp) {
  return new Date(weekStart(timestamp)).toISOString().slice(0, 10);
}

function minDefined(previous, next) {
  if (next == null) return previous;
  if (previous == null) return next;
  return Math.min(previous, next);
}

function maxDefined(previous, next) {
  if (next == null) return previous;
  if (previous == null) return next;
  return Math.max(previous, next);
}

function streamValue(row) {
  return finite(row?.stream_count ?? row?.reported_current_stream_count ?? row?.current_stream_count);
}

const MAX_STREAM_DELTA_GAP_MS = 20 * 60_000;

function fiveMinuteStreamDelta(previousCount, currentCount, elapsedMs) {
  if (previousCount == null || currentCount == null
    || elapsedMs <= 0 || elapsedMs > MAX_STREAM_DELTA_GAP_MS) return null;
  const delta = currentCount - previousCount;
  return delta >= 0 ? Math.round((delta * FIVE_MINUTES_MS / elapsedMs) * 10) / 10 : null;
}

export function stationheadReadModelKey(sourceValue) {
  return stationheadSourceProfile(sourceValue)?.modelKey || null;
}

export function stationheadFiveMinuteBucket(timestamp) {
  const value = Number(timestamp);
  return Number.isFinite(value) ? Math.floor(value / FIVE_MINUTES_MS) * FIVE_MINUTES_MS : null;
}

export function stationheadReadModelGapMode(
  previousAt,
  currentAt,
  {
    incrementalGapMs = STATIONHEAD_READ_MODEL_INCREMENTAL_GAP_MS,
    recoveryGapMs = STATIONHEAD_READ_MODEL_RECOVERY_GAP_MS,
  } = {},
) {
  const previous = Number(previousAt);
  const current = Number(currentAt);
  if (!Number.isFinite(previous) || !Number.isFinite(current) || current < previous) return 'bootstrap';
  const gap = current - previous;
  if (gap <= incrementalGapMs) return 'incremental';
  if (gap <= recoveryGapMs) return 'recovery';
  return 'bootstrap';
}

export function normalizeStationheadHistory(rows = []) {
  const normalized = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      observed_at: integer(row?.observed_at),
      online_member_count: integer(row?.online_member_count),
      total_member_count: integer(row?.total_member_count),
      stream_count: streamValue(row),
    }))
    .filter((row) => row.observed_at != null)
    .sort((left, right) => left.observed_at - right.observed_at);

  return normalized.map((row, index) => {
    const previous = normalized[index - 1];
    return {
      ...row,
      stream_delta_5m: previous
        ? fiveMinuteStreamDelta(
          previous.stream_count, row.stream_count,
          row.observed_at - previous.observed_at,
        )
        : null,
    };
  });
}

export function normalizeStationheadDaily(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    period_key: String(row?.period_key || ''),
    period_start: integer(row?.period_start),
    period_end: integer(row?.period_end),
    sample_count: integer(row?.sample_count) ?? 0,
    listener_avg: finite(row?.listener_avg),
    listener_min: integer(row?.listener_min),
    listener_max: integer(row?.listener_max),
    stream_start: integer(row?.stream_start),
    stream_end: integer(row?.stream_end),
    stream_growth: integer(row?.stream_growth),
    member_start: integer(row?.member_start),
    member_end: integer(row?.member_end),
    member_growth: integer(row?.member_growth),
  }));
}

export function nextStationheadDailySummary(existing, collection, observedAt) {
  const start = dayStart(observedAt);
  const end = start + DAY_MS;
  const key = periodKey(start);
  const current = existing && String(existing.period_key || '') === key ? existing : null;
  const previousSamples = integer(current?.sample_count) ?? 0;
  const online = integer(collection?.online_member_count);
  const hasOnline = online != null;
  const sampleCount = previousSamples + (hasOnline ? 1 : 0);
  const previousAverage = finite(current?.listener_avg);
  const listenerAvg = !hasOnline
    ? previousAverage
    : previousAverage == null || previousSamples < 1
      ? online
      : ((previousAverage * previousSamples) + online) / (previousSamples + 1);
  const stream = integer(streamValue(collection));
  const streamStart = integer(current?.stream_start) ?? stream;
  const streamEnd = stream ?? integer(current?.stream_end);
  const members = integer(collection?.total_member_count);
  const memberStart = integer(current?.member_start) ?? members;
  const memberEnd = members ?? integer(current?.member_end);
  return {
    period_key: key,
    period_start: start,
    period_end: end,
    sample_count: sampleCount,
    listener_avg: listenerAvg,
    listener_min: minDefined(integer(current?.listener_min), online),
    listener_max: maxDefined(integer(current?.listener_max), online),
    stream_start: streamStart,
    stream_end: streamEnd,
    stream_growth: streamStart == null || streamEnd == null ? null : streamEnd - streamStart,
    member_start: memberStart,
    member_end: memberEnd,
    member_growth: memberStart == null || memberEnd == null ? null : memberEnd - memberStart,
    updated_at: integer(observedAt),
  };
}

export function rollStationheadHistory(existingRows = [], collection, observedAt) {
  const cutoff = observedAt - DAY_MS;
  const bucket = stationheadFiveMinuteBucket(observedAt);
  const rows = (Array.isArray(existingRows) ? existingRows : [])
    .map((row) => ({
      observed_at: integer(row?.observed_at),
      online_member_count: integer(row?.online_member_count),
      total_member_count: integer(row?.total_member_count),
      stream_count: streamValue(row),
      stream_delta_5m: finite(row?.stream_delta_5m),
    }))
    .filter((row) => row.observed_at != null
      && row.observed_at >= cutoff
      && row.observed_at < observedAt
      && stationheadFiveMinuteBucket(row.observed_at) !== bucket)
    .sort((left, right) => left.observed_at - right.observed_at);
  const point = {
    observed_at: integer(collection?.observed_at ?? observedAt),
    online_member_count: integer(collection?.online_member_count),
    total_member_count: integer(collection?.total_member_count),
    stream_count: streamValue(collection),
    stream_delta_5m: null,
  };
  const previous = rows.at(-1);
  if (previous) {
    point.stream_delta_5m = fiveMinuteStreamDelta(
      previous.stream_count, point.stream_count,
      point.observed_at - previous.observed_at,
    );
  }
  return [...rows, point];
}

export function mergeStationheadDailyRows(existingRows = [], currentRow) {
  const normalizedCurrent = normalizeStationheadDaily([currentRow])[0];
  if (!normalizedCurrent?.period_key) return normalizeStationheadDaily(existingRows);
  return [
    normalizedCurrent,
    ...normalizeStationheadDaily(existingRows)
      .filter((row) => row.period_key && row.period_key !== normalizedCurrent.period_key),
  ].sort((left, right) => right.period_key.localeCompare(left.period_key));
}

function summaryBoundary(rows, key, direction) {
  const ordered = direction === 'start' ? rows : [...rows].reverse();
  for (const row of ordered) {
    const value = integer(row?.[key]);
    if (value != null) return value;
  }
  return null;
}

export function rollupStationheadWeekly(dailyRows = [], updatedAt = Date.now()) {
  const groups = new Map();
  for (const row of Array.isArray(dailyRows) ? dailyRows : []) {
    const start = integer(row?.period_start)
      ?? (/^\d{4}-\d{2}-\d{2}$/.test(String(row?.period_key || ''))
        ? Date.parse(`${row.period_key}T00:00:00Z`)
        : null);
    if (start == null) continue;
    const startOfWeek = weekStart(start);
    const key = stationheadUtcWeekKey(startOfWeek);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const weekly = [];
  for (const [key, sourceRows] of groups.entries()) {
    const rows = [...sourceRows].sort((left, right) => {
      const leftStart = integer(left?.period_start) ?? Date.parse(`${left?.period_key}T00:00:00Z`);
      const rightStart = integer(right?.period_start) ?? Date.parse(`${right?.period_key}T00:00:00Z`);
      return leftStart - rightStart;
    });
    const sampleCount = rows.reduce((sum, row) => sum + Math.max(0, integer(row?.sample_count) ?? 0), 0);
    const averageWeight = rows.reduce((sum, row) => {
      const count = Math.max(0, integer(row?.sample_count) ?? 0);
      return finite(row?.listener_avg) == null ? sum : sum + count;
    }, 0);
    const listenerAvg = averageWeight > 0
      ? rows.reduce((sum, row) => {
        const value = finite(row?.listener_avg);
        const count = Math.max(0, integer(row?.sample_count) ?? 0);
        return value == null ? sum : sum + value * count;
      }, 0) / averageWeight
      : null;
    const listenerMins = rows.map((row) => integer(row?.listener_min)).filter((value) => value != null);
    const listenerMaxs = rows.map((row) => integer(row?.listener_max)).filter((value) => value != null);
    const streamStart = summaryBoundary(rows, 'stream_start', 'start');
    const streamEnd = summaryBoundary(rows, 'stream_end', 'end');
    const memberStart = summaryBoundary(rows, 'member_start', 'start');
    const memberEnd = summaryBoundary(rows, 'member_end', 'end');
    const startOfWeek = Date.parse(`${key}T00:00:00Z`);
    weekly.push({
      period_key: key,
      period_start: startOfWeek,
      period_end: startOfWeek + 7 * DAY_MS,
      sample_count: sampleCount,
      listener_avg: listenerAvg,
      listener_min: listenerMins.length ? Math.min(...listenerMins) : null,
      listener_max: listenerMaxs.length ? Math.max(...listenerMaxs) : null,
      stream_start: streamStart,
      stream_end: streamEnd,
      stream_growth: streamStart == null || streamEnd == null || streamEnd < streamStart ? null : streamEnd - streamStart,
      member_start: memberStart,
      member_end: memberEnd,
      member_growth: memberStart == null || memberEnd == null ? null : memberEnd - memberStart,
      updated_at: integer(updatedAt),
    });
  }
  return weekly.sort((left, right) => right.period_key.localeCompare(left.period_key));
}

export function stationheadAggregateReadModelPayload(
  sourceValue,
  collection,
  historyRows = [],
  dailyRows = [],
  updatedAt = Date.now(),
) {
  const profile = stationheadSourceProfile(sourceValue);
  if (!profile) throw new Error(`unsupported Stationhead source: ${String(sourceValue || '<empty>')}`);
  const streamCount = streamValue(collection);
  return {
    ok: true,
    model: profile.modelKey,
    channel_alias: profile.channelAlias,
    source: profile.source,
    timezone: 'UTC',
    updated_at: integer(updatedAt),
    latest: {
      observed_at: integer(collection?.observed_at ?? updatedAt),
      channel_id: integer(collection?.channel_id),
      station_id: integer(collection?.station_id),
      is_broadcasting: integer(collection?.is_broadcasting),
      online_member_count: integer(collection?.online_member_count),
      total_member_count: integer(collection?.total_member_count),
      total_stream_count: streamCount == null ? null : Math.trunc(streamCount),
    },
    history_24h: normalizeStationheadHistory(historyRows),
    daily: normalizeStationheadDaily(dailyRows),
  };
}
