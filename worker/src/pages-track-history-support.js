const DAY_MS = 86_400_000;
const TRACK_HISTORY_DAYS = 35;
const TRACK_HISTORY_HOURLY_DAYS = 1;
const TRACK_HISTORY_RECENT_REPAIR_DAYS = 7;
const TRACK_HISTORY_BACKFILL_DAYS = 1;
const TRACK_HISTORY_FULL_RECONCILE_MS = 30 * DAY_MS;
const TRACK_HISTORY_EPOCH = Date.UTC(2024, 4, 1);

function dayText(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function validTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : null;
}

export function trackHistoryRefreshRanges(now, backfillState = null, statusState = null) {
  const currentDayStart = Math.floor(now / DAY_MS) * DAY_MS;
  const fullRecentFrom = currentDayStart - TRACK_HISTORY_DAYS * DAY_MS;
  const hourlyRecentFrom = currentDayStart - TRACK_HISTORY_HOURLY_DAYS * DAY_MS;
  const recentRepairFrom = currentDayStart - TRACK_HISTORY_RECENT_REPAIR_DAYS * DAY_MS;
  const toTs = currentDayStart;
  const previousFullAt = validTimestamp(
    statusState?.full_reconciled_at ?? statusState?.generated_at,
  );
  const fullReconcile = previousFullAt == null
    || previousFullAt + TRACK_HISTORY_FULL_RECONCILE_MS <= currentDayStart;
  const recentRepair = !fullReconcile
    && validTimestamp(statusState?.recent_repair_completed_at) == null;
  const fullRecent = { fromTs: fullRecentFrom, toTs };
  const recent = {
    fromTs: fullReconcile
      ? fullRecentFrom
      : recentRepair
        ? recentRepairFrom
        : hourlyRecentFrom,
    toTs,
  };
  const storedCursor = Number(backfillState?.next_to);
  const backfillTo = Math.min(
    Number.isFinite(storedCursor) ? storedCursor : fullRecentFrom,
    fullRecentFrom,
  );
  const backfill = backfillTo <= TRACK_HISTORY_EPOCH
    ? null
    : {
      fromTs: Math.max(TRACK_HISTORY_EPOCH, backfillTo - TRACK_HISTORY_BACKFILL_DAYS * DAY_MS),
      toTs: backfillTo,
    };
  return {
    recent,
    fullRecent,
    fullReconcile,
    recentRepair,
    previousFullAt,
    backfill,
  };
}

export function mergeTrackHistoryExcludedDates(previousDates, refreshedDates, range) {
  const fromDay = dayText(range.fromTs);
  const toDay = dayText(range.toTs - 1);
  const retained = Array.isArray(previousDates)
    ? previousDates.filter((date) => String(date) < fromDay || String(date) > toDay)
    : [];
  const refreshed = Array.isArray(refreshedDates) ? refreshedDates : [];
  return [...new Set([...retained, ...refreshed].map(String).filter(Boolean))].sort();
}
