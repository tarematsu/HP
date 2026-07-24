const MANUAL_IMPORT_METHOD = 'manual-browser-import';
const MANUAL_IMPORT_STATUS_LIMIT = 256;

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function timing(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

function hostnameFromSourceUrl(value, cache) {
  const raw = String(value || '').trim();
  if (cache?.has(raw)) return cache.get(raw);

  let hostname = 'unknown';
  if (raw) {
    try {
      hostname = new URL(raw).hostname.replace(/^www\./i, '').toLowerCase() || 'unknown';
    } catch {
      hostname = 'unknown';
    }
  }
  cache?.set(raw, hostname);
  return hostname;
}

function sourceLabel(hostname) {
  if (hostname === 'unknown') return 'Unknown';
  return hostname;
}

function failed(row) {
  return Boolean(row?.error);
}

function addTimingTotals(target, row) {
  const collectionDurationMs = timing(row.collectionDurationMs);
  const databaseDurationMs = timing(row.databaseDurationMs);
  const totalDurationMs = timing(row.totalDurationMs);

  if (collectionDurationMs !== null) target.collectionDurationMs += collectionDurationMs;
  if (databaseDurationMs !== null) target.databaseDurationMs += databaseDurationMs;
  if (totalDurationMs !== null) target.totalDurationMs += totalDurationMs;
  if (totalDurationMs !== null || collectionDurationMs !== null || databaseDurationMs !== null) {
    target.measuredTimingRuns += 1;
  }
}

function latestRunPayload(row, siteKey) {
  if (!row) return null;
  const foundCount = count(row.foundCount);
  const insertedCount = Math.min(foundCount, count(row.insertedCount));
  return {
    sourceMethod: row.sourceMethod,
    sourceUrl: row.sourceUrl || null,
    siteKey,
    startedAt: row.startedAt || null,
    completedAt: row.completedAt || null,
    foundCount,
    insertedCount,
    duplicateOrExistingCount: Math.max(0, foundCount - insertedCount),
    failed: failed(row),
    error: row.error || null,
    collectionDurationMs: timing(row.collectionDurationMs),
    databaseDurationMs: timing(row.databaseDurationMs),
    totalDurationMs: timing(row.totalDurationMs)
  };
}

export function manualImportRunsStatement(db, limit = MANUAL_IMPORT_STATUS_LIMIT) {
  return db.prepare(
    `SELECT runs.source_method AS sourceMethod,
            runs.source_url AS sourceUrl,
            runs.started_at AS startedAt,
            runs.completed_at AS completedAt,
            runs.found_count AS foundCount,
            runs.inserted_count AS insertedCount,
            NULLIF(runs.error, '') AS error,
            timing.collection_duration_ms AS collectionDurationMs,
            timing.database_duration_ms AS databaseDurationMs,
            timing.total_duration_ms AS totalDurationMs
       FROM collection_runs AS runs
       LEFT JOIN collection_run_timings AS timing ON timing.run_id = runs.id
      WHERE runs.source_method = ?
      ORDER BY runs.id DESC
      LIMIT ?`
  ).bind(MANUAL_IMPORT_METHOD, limit);
}

export function buildManualImportSiteStatus(rows = []) {
  const sites = {};
  const siteCounts = {};
  const hostnameCache = new Map();
  const latestTotals = {
    importedCount: 0,
    insertedCount: 0,
    duplicateOrExistingCount: 0,
    runCount: 0,
    successfulRuns: 0,
    failedRuns: 0,
    collectionDurationMs: 0,
    databaseDurationMs: 0,
    totalDurationMs: 0,
    measuredTimingRuns: 0
  };

  const firstRow = rows[0] || null;
  const latestRun = firstRow
    ? latestRunPayload(firstRow, hostnameFromSourceUrl(firstRow.sourceUrl, hostnameCache))
    : null;

  for (const row of rows) {
    const siteKey = hostnameFromSourceUrl(row.sourceUrl, hostnameCache);
    const foundCount = count(row.foundCount);
    const insertedCount = Math.min(foundCount, count(row.insertedCount));
    const duplicateOrExistingCount = Math.max(0, foundCount - insertedCount);
    const rowFailed = failed(row);

    if (!sites[siteKey]) {
      sites[siteKey] = {
        key: siteKey,
        name: sourceLabel(siteKey),
        sourceUrlSample: row.sourceUrl || null,
        method: MANUAL_IMPORT_METHOD,
        status: 'ok',
        runCount: 0,
        successfulRuns: 0,
        failedRuns: 0,
        importedCount: 0,
        insertedCount: 0,
        duplicateOrExistingCount: 0,
        collectionDurationMs: 0,
        databaseDurationMs: 0,
        totalDurationMs: 0,
        measuredTimingRuns: 0,
        firstRunAt: null,
        latestRunAt: null,
        latestCompletedAt: null,
        latestError: null,
        latestRun: null
      };
    }

    const site = sites[siteKey];
    site.runCount += 1;
    site.importedCount += foundCount;
    site.insertedCount += insertedCount;
    site.duplicateOrExistingCount += duplicateOrExistingCount;
    if (rowFailed) {
      site.failedRuns += 1;
      if (!site.latestError) site.latestError = row.error || null;
    } else {
      site.successfulRuns += 1;
    }
    addTimingTotals(site, row);

    const startedAt = row.startedAt || null;
    const completedAt = row.completedAt || null;
    if (!site.latestRunAt || (startedAt && startedAt > site.latestRunAt)) {
      site.latestRunAt = startedAt;
      site.latestCompletedAt = completedAt;
      site.latestRun = latestRunPayload(row, siteKey);
    }
    if (!site.firstRunAt || (startedAt && startedAt < site.firstRunAt)) site.firstRunAt = startedAt;

    latestTotals.importedCount += foundCount;
    latestTotals.insertedCount += insertedCount;
    latestTotals.duplicateOrExistingCount += duplicateOrExistingCount;
    latestTotals.runCount += 1;
    if (rowFailed) latestTotals.failedRuns += 1;
    else latestTotals.successfulRuns += 1;
    addTimingTotals(latestTotals, row);
  }

  for (const site of Object.values(sites)) {
    site.status = site.runCount > 0 && site.successfulRuns === 0 && site.failedRuns > 0
      ? 'error'
      : 'ok';
    siteCounts[site.key] = site.insertedCount;
  }

  const orderedSites = Object.fromEntries(
    Object.entries(sites).sort(([, a], [, b]) => {
      const aTime = Date.parse(a.latestRunAt || '') || 0;
      const bTime = Date.parse(b.latestRunAt || '') || 0;
      return bTime - aTime || b.insertedCount - a.insertedCount;
    })
  );

  return {
    manualImport: {
      method: MANUAL_IMPORT_METHOD,
      sampledRunLimit: MANUAL_IMPORT_STATUS_LIMIT,
      sampledRunCount: rows.length,
      latestRun,
      totals: latestTotals
    },
    latest: latestTotals,
    latestSourceRun: latestRun,
    siteCounts,
    sites: orderedSites
  };
}

export { MANUAL_IMPORT_METHOD, MANUAL_IMPORT_STATUS_LIMIT };
