const MINUTE_MS = 60_000;

export const DEFAULT_HARD_LOW_LISTENER_MAX = 15;
export const DEFAULT_CONTEXT_MEDIAN_MIN = 30;
export const DEFAULT_LOCAL_RADIUS_MINUTES = 5;
export const DEFAULT_LOCAL_MIN_NEIGHBORS = 4;
export const DEFAULT_LOCAL_DROP_RATIO = 0.25;
export const DEFAULT_LOCAL_DROP_ABSOLUTE = 20;

function finiteInteger(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function median(values) {
  const sorted = values
    .map(finiteInteger)
    .filter((value) => value != null)
    .sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function normalizeRows(rows = []) {
  const byMinute = new Map();
  for (const raw of rows) {
    const minuteAt = finiteInteger(raw?.minute_at);
    if (minuteAt == null) continue;
    const candidate = {
      id: finiteInteger(raw?.id) || 0,
      minute_at: minuteAt,
      listener_count: finiteInteger(raw?.listener_count),
      is_broadcasting: finiteInteger(raw?.is_broadcasting),
    };
    const previous = byMinute.get(minuteAt);
    if (!previous || candidate.id >= previous.id) byMinute.set(minuteAt, candidate);
  }
  return [...byMinute.values()].sort((left, right) => left.minute_at - right.minute_at || left.id - right.id);
}

function broadcastingListener(row) {
  return row?.is_broadcasting === 1 && row?.listener_count != null && row.listener_count >= 0;
}

function localBaseline(rows, index, radiusMinutes) {
  const current = rows[index];
  const radiusMs = radiusMinutes * MINUTE_MS;
  const values = [];
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const row = rows[cursor];
    if (current.minute_at - row.minute_at > radiusMs) break;
    if (broadcastingListener(row)) values.push(row.listener_count);
  }
  for (let cursor = index + 1; cursor < rows.length; cursor += 1) {
    const row = rows[cursor];
    if (row.minute_at - current.minute_at > radiusMs) break;
    if (broadcastingListener(row)) values.push(row.listener_count);
  }
  return { count: values.length, median: median(values) };
}

export function auditListenerAnomalies(rawRows = [], options = {}) {
  const rows = normalizeRows(rawRows);
  const hardLowMax = finiteInteger(options.hardLowMax) ?? DEFAULT_HARD_LOW_LISTENER_MAX;
  const contextMedianMin = finiteInteger(options.contextMedianMin) ?? DEFAULT_CONTEXT_MEDIAN_MIN;
  const localRadiusMinutes = finiteInteger(options.localRadiusMinutes) ?? DEFAULT_LOCAL_RADIUS_MINUTES;
  const localMinNeighbors = finiteInteger(options.localMinNeighbors) ?? DEFAULT_LOCAL_MIN_NEIGHBORS;
  const localDropRatio = Number.isFinite(Number(options.localDropRatio))
    ? Number(options.localDropRatio)
    : DEFAULT_LOCAL_DROP_RATIO;
  const localDropAbsolute = finiteInteger(options.localDropAbsolute) ?? DEFAULT_LOCAL_DROP_ABSOLUTE;

  const broadcastingValues = rows.filter(broadcastingListener).map((row) => row.listener_count);
  const broadcastMedian = median(broadcastingValues);
  const anomalies = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.is_broadcasting !== 1) continue;
    const local = localBaseline(rows, index, localRadiusMinutes);
    const contextBaseline = local.median ?? broadcastMedian;

    if (row.listener_count == null || row.listener_count < 0) {
      anomalies.push({
        minute_at: row.minute_at,
        listener_count: row.listener_count,
        reason: 'missing_or_invalid_listener',
        local_median: local.median,
        local_neighbor_count: local.count,
      });
      continue;
    }

    if (row.listener_count <= hardLowMax && contextBaseline != null && contextBaseline >= contextMedianMin) {
      anomalies.push({
        minute_at: row.minute_at,
        listener_count: row.listener_count,
        reason: 'implausibly_low_listener',
        local_median: local.median,
        local_neighbor_count: local.count,
      });
      continue;
    }

    if (local.count < localMinNeighbors || local.median == null || local.median < contextMedianMin) continue;
    const ratio = local.median > 0 ? row.listener_count / local.median : 1;
    if (ratio <= localDropRatio && local.median - row.listener_count >= localDropAbsolute) {
      anomalies.push({
        minute_at: row.minute_at,
        listener_count: row.listener_count,
        reason: 'local_listener_collapse',
        local_median: local.median,
        local_neighbor_count: local.count,
        ratio,
      });
    }
  }

  return {
    rows,
    broadcast_sample_count: broadcastingValues.length,
    broadcast_median: broadcastMedian,
    anomalies,
    anomaly_count: anomalies.length,
    hard_low_count: anomalies.filter((item) => item.reason === 'implausibly_low_listener').length,
    local_collapse_count: anomalies.filter((item) => item.reason === 'local_listener_collapse').length,
    invalid_listener_count: anomalies.filter((item) => item.reason === 'missing_or_invalid_listener').length,
  };
}
