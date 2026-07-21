import { timeoutForMethod } from './collection-guardrails.js';
import { PLAYBACK_FEED_LIMIT } from './source-feed.js';

const SCHEDULE_FRESHNESS_GRACE_MS = 30 * 60_000;

const SOURCE_DEFINITIONS = [
  { key: 'sourceA', name: 'TwiXive', method: 'source-a-browser' },
  { key: 'sourceB', name: 'TwiVideo', method: 'source-b-browser' },
  { key: 'sourceE', name: 'TwiKeep', method: 'source-e-browser' }
];

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function timing(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

function failed(row) {
  return Boolean(Number(row?.failed || 0) || row?.error);
}

export function latestScheduledAt(schedule, nowMs = Date.now()) {
  const match = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/.exec(schedule || '');
  if (!match) return null;
  const minute = Number(match[1]);
  const hour = Number(match[2]);
  if (minute > 59 || hour > 23) return null;

  const now = new Date(nowMs);
  let scheduledMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    hour,
    minute
  );
  if (scheduledMs > nowMs) scheduledMs -= 24 * 60 * 60_000;
  return scheduledMs;
}

export function collectionRunStatus(row, method, schedule = null, nowMs = Date.now()) {
  if (!row) return 'never-run';
  if (row.completedAt) {
    if (failed(row)) return 'error';
    const expectedMs = latestScheduledAt(schedule, nowMs);
    const startedMs = Date.parse(row.startedAt || '');
    if (
      expectedMs !== null
      && nowMs >= expectedMs + SCHEDULE_FRESHNESS_GRACE_MS
      && (!Number.isFinite(startedMs) || startedMs < expectedMs)
    ) {
      return 'stale';
    }
    return 'ok';
  }
  if (failed(row)) return 'error';

  const startedMs = Date.parse(row.startedAt || '');
  if (!Number.isFinite(startedMs)) return 'running';
  const staleAfterMs = timeoutForMethod(method) + 30_000;
  return nowMs - startedMs > staleAfterMs ? 'stalled' : 'running';
}

export function buildSiteStatus(schedules, rows = [], nowMs = Date.now()) {
  const byMethod = new Map(rows.map((row) => [row.sourceMethod, row]));
  const sites = {};
  const siteCounts = {};
  const scheduleTimings = {};
  const latestRunTotals = {
    collectedCount: 0,
    insertedCount: 0,
    duplicateOrExistingCount: 0,
    collectionDurationMs: 0,
    databaseDurationMs: 0,
    totalDurationMs: 0,
    measuredTimingSites: 0,
    successfulSites: 0,
    failedSites: 0,
    neverRunSites: 0
  };

  for (const definition of SOURCE_DEFINITIONS) {
    const row = byMethod.get(definition.method) || null;
    const hasRun = Boolean(row);
    const collectedCount = hasRun ? count(row.foundCount) : null;
    const insertedCount = hasRun
      ? Math.min(collectedCount, count(row.insertedCount))
      : null;
    const duplicateOrExistingCount = hasRun
      ? collectedCount - insertedCount
      : null;
    const collectionDurationMs = timing(row?.collectionDurationMs);
    const databaseDurationMs = timing(row?.databaseDurationMs);
    const totalDurationMs = timing(row?.totalDurationMs);
    const schedule = schedules[definition.key] || null;
    const expectedAtMs = latestScheduledAt(schedule, nowMs);
    const status = collectionRunStatus(row, definition.method, schedule, nowMs);

    sites[definition.key] = {
      name: definition.name,
      method: definition.method,
      schedule,
      status,
      stale: status === 'stale',
      expectedAt: expectedAtMs === null ? null : new Date(expectedAtMs).toISOString(),
      hasRun,
      failed: hasRun ? failed(row) : null,
      collectedCount,
      insertedCount,
      duplicateOrExistingCount,
      collectionDurationMs,
      databaseDurationMs,
      totalDurationMs,
      startedAt: row?.startedAt || null,
      completedAt: row?.completedAt || null
    };
    siteCounts[definition.key] = collectedCount;

    if (schedule) {
      scheduleTimings[schedule] ||= {
        siteKeys: [],
        measuredSites: 0,
        collectionDurationMs: 0,
        databaseDurationMs: 0,
        sequentialTotalDurationMs: 0,
        allSitesMeasured: false
      };
      const scheduleTiming = scheduleTimings[schedule];
      scheduleTiming.siteKeys.push(definition.key);
      if (totalDurationMs !== null) {
        scheduleTiming.measuredSites += 1;
        scheduleTiming.collectionDurationMs += collectionDurationMs || 0;
        scheduleTiming.databaseDurationMs += databaseDurationMs || 0;
        scheduleTiming.sequentialTotalDurationMs += totalDurationMs;
      }
    }

    if (hasRun) {
      latestRunTotals.collectedCount += collectedCount;
      latestRunTotals.insertedCount += insertedCount;
      latestRunTotals.duplicateOrExistingCount += duplicateOrExistingCount;
    }
    if (totalDurationMs !== null) {
      latestRunTotals.collectionDurationMs += collectionDurationMs || 0;
      latestRunTotals.databaseDurationMs += databaseDurationMs || 0;
      latestRunTotals.totalDurationMs += totalDurationMs;
      latestRunTotals.measuredTimingSites += 1;
    }
    if (status === 'ok') latestRunTotals.successfulSites += 1;
    else if (status === 'error' || status === 'stalled' || status === 'stale') {
      latestRunTotals.failedSites += 1;
    } else if (status === 'never-run') latestRunTotals.neverRunSites += 1;
  }

  for (const scheduleTiming of Object.values(scheduleTimings)) {
    scheduleTiming.allSitesMeasured = scheduleTiming.measuredSites === scheduleTiming.siteKeys.length;
  }

  return {
    storagePolicy: {
      storedUrlLimit: null,
      deduplication: 'media-host-and-path',
      storedCountField: 'counts.activeVideos',
      playbackFeedLimit: PLAYBACK_FEED_LIMIT,
      playbackFeedCountField: 'counts.feedVideos',
      note: 'All unique collected URLs are stored; the playback feed is a separate recent-item window.'
    },
    siteCounts,
    sites,
    scheduleTimings,
    latestRunTotals
  };
}

export { SOURCE_DEFINITIONS, SOURCE_DEFINITIONS as SITE_DEFINITIONS };
