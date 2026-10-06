export const OHISAMA_PAGES_MODEL_KEY = 'hinata';
export const OHISAMA_PAGES_CADENCE_SECONDS = 5 * 60;

const DAY_MS = 24 * 60 * 60_000;
const FIVE_MINUTES_MS = 5 * 60_000;
const HISTORY_WINDOW_MS = DAY_MS;

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integer(value) {
  const number = finite(value);
  return number == null ? null : Math.trunc(number);
}

function streamValue(row) {
  return finite(row?.reported_current_stream_count);
}

function dayStart(timestamp) {
  return Math.floor(Number(timestamp) / DAY_MS) * DAY_MS;
}

function periodKey(timestamp) {
  return new Date(dayStart(timestamp)).toISOString().slice(0, 10);
}

function fiveMinuteBucket(timestamp) {
  return Math.floor(Number(timestamp) / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
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

function normalizedHistoryPoint(row) {
  return {
    observed_at: integer(row?.observed_at),
    online_member_count: integer(row?.online_member_count),
    total_member_count: integer(row?.total_member_count),
    stream_count: finite(row?.stream_count ?? row?.reported_current_stream_count),
    stream_delta_5m: finite(row?.stream_delta_5m),
  };
}

export function normalizeOhisamaHistory(rows = []) {
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
    let streamDelta = null;
    if (previous && row.stream_count != null && previous.stream_count != null) {
      const elapsed = row.observed_at - previous.observed_at;
      const delta = row.stream_count - previous.stream_count;
      if (elapsed > 0 && delta >= 0) {
        streamDelta = delta * FIVE_MINUTES_MS / elapsed;
      }
    }
    return {
      observed_at: row.observed_at,
      online_member_count: row.online_member_count,
      total_member_count: row.total_member_count,
      stream_count: row.stream_count,
      stream_delta_5m: streamDelta == null ? null : Math.round(streamDelta * 10) / 10,
    };
  });
}

export function normalizeOhisamaDaily(rows = []) {
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

function buildPayload(collection, historyRows, dailyRows, updatedAt) {
  const streamCount = finite(collection?.reported_current_stream_count);
  return {
    ok: true,
    model: OHISAMA_PAGES_MODEL_KEY,
    channel_alias: 'ohisama',
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
    history_24h: historyRows,
    daily: dailyRows,
  };
}

export function ohisamaReadModelPayload(collection, historyRows = [], dailyRows = [], updatedAt = Date.now()) {
  return buildPayload(
    collection,
    normalizeOhisamaHistory(historyRows),
    normalizeOhisamaDaily(dailyRows),
    updatedAt,
  );
}

export function nextOhisamaDailySummary(existing, collection, observedAt) {
  const start = dayStart(observedAt);
  const end = start + DAY_MS;
  const key = periodKey(start);
  const current = existing && String(existing.period_key || '') === key ? existing : null;

  const previousSamples = integer(current?.sample_count) ?? 0;
  const online = integer(collection?.online_member_count);
  const hasOnline = online != null;
  const sampleCount = previousSamples + (hasOnline ? 1 : 0);
  const previousAverage = finite(current?.listener_avg);
  let listenerAvg = previousAverage;
  if (hasOnline) {
    listenerAvg = previousAverage == null || previousSamples < 1
      ? online
      : ((previousAverage * previousSamples) + online) / (previousSamples + 1);
  }

  const stream = integer(collection?.reported_current_stream_count);
  const previousStreamStart = integer(current?.stream_start);
  const previousStreamEnd = integer(current?.stream_end);
  const streamStart = previousStreamStart ?? stream;
  const streamEnd = stream ?? previousStreamEnd;

  const members = integer(collection?.total_member_count);
  const previousMemberStart = integer(current?.member_start);
  const previousMemberEnd = integer(current?.member_end);
  const memberStart = previousMemberStart ?? members;
  const memberEnd = members ?? previousMemberEnd;

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

export function rollOhisamaHistory(existingRows = [], collection, observedAt) {
  const cutoff = observedAt - HISTORY_WINDOW_MS;
  const bucket = fiveMinuteBucket(observedAt);
  const rows = (Array.isArray(existingRows) ? existingRows : [])
    .map(normalizedHistoryPoint)
    .filter((row) => row.observed_at != null
      && row.observed_at >= cutoff
      && row.observed_at < observedAt
      && fiveMinuteBucket(row.observed_at) !== bucket)
    .sort((left, right) => left.observed_at - right.observed_at);

  const point = {
    observed_at: integer(collection?.observed_at ?? observedAt),
    online_member_count: integer(collection?.online_member_count),
    total_member_count: integer(collection?.total_member_count),
    stream_count: finite(collection?.reported_current_stream_count),
    stream_delta_5m: null,
  };
  const previous = rows.at(-1);
  if (previous && point.stream_count != null && previous.stream_count != null) {
    const elapsed = point.observed_at - previous.observed_at;
    const delta = point.stream_count - previous.stream_count;
    if (elapsed > 0 && delta >= 0) {
      point.stream_delta_5m = Math.round((delta * FIVE_MINUTES_MS / elapsed) * 10) / 10;
    }
  }
  return [...rows, point];
}

export function mergeOhisamaDailyRows(existingRows = [], currentRow) {
  const normalizedCurrent = normalizeOhisamaDaily([currentRow])[0];
  if (!normalizedCurrent?.period_key) return normalizeOhisamaDaily(existingRows);
  return [
    normalizedCurrent,
    ...normalizeOhisamaDaily(existingRows)
      .filter((row) => row.period_key && row.period_key !== normalizedCurrent.period_key),
  ].sort((left, right) => right.period_key.localeCompare(left.period_key));
}
