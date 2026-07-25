export const REBUILD_SOURCE_RETENTION_MS = Number.POSITIVE_INFINITY;

export const BUDDIES_UNLIMITED_RETENTION_TABLES = Object.freeze([
  'sh_channel_snapshots',
  'sh_queue_snapshots',
  'sh_comment_minute_counts',
  'sh_queue_items',
  'sh_track_like_observations',
  'sh_track_metadata',
  'sh_ingest_claims',
  'sh_ingest_conflicts',
]);

// BUDDIES_DB is an archival source for reconstruction and history. Retention is
// intentionally unlimited: no environment override may re-enable age-based
// deletion for these tables.
export function snapshotRetentionEnabled() {
  return false;
}

export function shouldRunSnapshotRetention() {
  return false;
}

export async function pruneOldSnapshots() {
  return { skipped: true, reason: 'unlimited-retention' };
}

export async function pruneOldSnapshotsSafely() {
  return pruneOldSnapshots();
}
