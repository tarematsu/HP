export const REBUILD_SOURCE_RETENTION_MS = 30 * 24 * 60 * 60_000;
const DEFAULT_RETENTION_MS = REBUILD_SOURCE_RETENTION_MS;
const MIN_RETENTION_MS = REBUILD_SOURCE_RETENTION_MS;
const DEFAULT_INTERVAL_MS = 60 * 60_000;
const MIN_INTERVAL_MS = 15 * 60_000;
const DEFAULT_BATCH_SIZE = 1000;
const MAX_BATCH_SIZE = 5000;
const DEFAULT_MAX_BATCHES = 5;
const MAX_MAX_BATCHES = 100;
const DAY_MS = 24 * 60 * 60_000;
const MINUTE_MS = 60_000;
const MAX_FACT_CHECK_DAYS = 4;
const STATE_ID = 'snapshot-retention-v1';
const REQUIRED_RETENTION_INDEXES = Object.freeze([
  'idx_sh_channel_snapshots_observed_id',
  'idx_sh_queue_snapshots_time',
  'idx_sh_comment_minute_counts_bucket',
  'idx_sh_queue_items_observed',
  'idx_sh_track_like_observations_time',
  'idx_sh_track_metadata_fetched_at',
  'idx_sh_ingest_claims_observed',
  'idx_sh_ingest_conflicts_observed',
]);
const AUXILIARY_TABLES = [
  // These sources remain useful for repairs inside the rebuild horizon. Past
  // that horizon they can be removed independently of channel snapshots.
  { name: 'sh_queue_snapshots', timeColumn: 'observed_at', keyColumn: 'id' },
  { name: 'sh_comment_minute_counts', timeColumn: 'bucket_start', keyColumn: 'rowid' },
  { name: 'sh_queue_items', timeColumn: 'observed_at', keyColumn: 'id' },
  { name: 'sh_track_like_observations', timeColumn: 'observed_at', keyColumn: 'id' },
  { name: 'sh_track_metadata', timeColumn: 'fetched_at', keyColumn: 'rowid' },
  { name: 'sh_ingest_claims', timeColumn: 'observed_at', keyColumn: 'rowid' },
  { name: 'sh_ingest_conflicts', timeColumn: 'observed_at', keyColumn: 'id' },
];

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function retentionMs(env = {}) {
  const configured = Number(env.SNAPSHOT_RETENTION_MS ?? DEFAULT_RETENTION_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_RETENTION_MS;
  return Math.max(MIN_RETENTION_MS, Math.trunc(configured));
}

function intervalMs(env = {}) {
  const configured = Number(env.SNAPSHOT_RETENTION_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, Math.trunc(configured));
}

function batchSize(env = {}) {
  const configured = Number(env.SNAPSHOT_RETENTION_BATCH_SIZE ?? DEFAULT_BATCH_SIZE);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_BATCH_SIZE;
  return Math.min(MAX_BATCH_SIZE, Math.max(100, Math.trunc(configured)));
}

function maxBatches(env = {}) {
  const configured = Number(env.SNAPSHOT_RETENTION_MAX_BATCHES ?? DEFAULT_MAX_BATCHES);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_MAX_BATCHES;
  return Math.min(MAX_MAX_BATCHES, Math.max(1, Math.trunc(configured)));
}

export function snapshotRetentionEnabled(env = {}) {
  const configured = env.SNAPSHOT_RETENTION_ENABLED;
  if (configured == null || configured === '') return true;
  return !['0', 'false', 'no', 'off'].includes(String(configured).trim().toLowerCase());
}

export function shouldRunSnapshotRetention(lastCleanupAt, now = Date.now(), env = {}) {
  return now - Number(lastCleanupAt || 0) >= intervalMs(env);
}

async function missingRetentionIndexes(db) {
  const placeholders = REQUIRED_RETENTION_INDEXES.map(() => '?').join(',');
  const result = await db.prepare(`SELECT name FROM sqlite_schema
    WHERE type='index' AND name IN (${placeholders})`)
    .bind(...REQUIRED_RETENTION_INDEXES)
    .all();
  const installed = new Set((result?.results || []).map((row) => String(row?.name || '')));
  return REQUIRED_RETENTION_INDEXES.filter((name) => !installed.has(name));
}

function deleteStatement(db, table, cutoff, size) {
  return db.prepare(`DELETE FROM ${table.name} WHERE ${table.keyColumn} IN (
      SELECT ${table.keyColumn} FROM ${table.name}
      WHERE ${table.timeColumn}<? ORDER BY ${table.timeColumn} ASC LIMIT ?
    )`).bind(cutoff, size);
}

async function runDeleteRound(db, tables, cutoff, size) {
  const statements = tables.map((table) => deleteStatement(db, table, cutoff, size));
  if (typeof db.batch === 'function') return db.batch(statements);
  const results = [];
  for (const statement of statements) results.push(await statement.run());
  return results;
}

async function pruneTables(db, tables, cutoff, size, batches) {
  const deleted = Object.fromEntries(tables.map((table) => [table.name, 0]));
  let active = tables;
  for (let batch = 0; batch < batches && active.length; batch += 1) {
    const results = await runDeleteRound(db, active, cutoff, size);
    const next = [];
    for (let index = 0; index < active.length; index += 1) {
      const table = active[index];
      const changes = Number(results[index]?.meta?.changes || 0);
      deleted[table.name] += changes;
      if (changes >= size) next.push(table);
    }
    active = next;
  }
  return deleted;
}

function minuteAt(observedAt) {
  const value = integer(observedAt);
  return value == null ? null : Math.floor(value / MINUTE_MS) * MINUTE_MS;
}

function dayAt(observedAt) {
  const value = integer(observedAt);
  return value == null ? null : Math.floor(value / DAY_MS) * DAY_MS;
}

function factKey(channelId, minute) {
  return `${channelId}:${minute}`;
}

async function loadChannelSnapshotCandidates(db, cutoff, size) {
  const result = await db.prepare(`SELECT id,channel_id,observed_at
    FROM sh_channel_snapshots INDEXED BY idx_sh_channel_snapshots_observed_id
    WHERE observed_at<?
    ORDER BY observed_at ASC,id ASC
    LIMIT ?`).bind(cutoff, size).all();
  return (result?.results || []).map((row) => ({
    id: integer(row.id),
    channelId: integer(row.channel_id),
    observedAt: integer(row.observed_at),
  })).filter((row) => row.id != null && row.observedAt != null);
}

async function loadMaterializedFactKeys(minuteDb, start, end) {
  const result = await minuteDb.prepare(`SELECT channel_id,minute_at
    FROM sh_minute_facts INDEXED BY idx_sh_minute_facts_time
    WHERE minute_at>=? AND minute_at<?`).bind(start, end).all();
  return new Set((result?.results || []).map((row) => (
    factKey(integer(row.channel_id), integer(row.minute_at))
  )));
}

async function deletableChannelSnapshotIds(db, minuteDb, cutoff, size) {
  const candidates = await loadChannelSnapshotCandidates(db, cutoff, size);
  if (!candidates.length) return { ids: [], scanned: 0, protected: 0 };
  if (!minuteDb?.prepare) {
    return { ids: [], scanned: candidates.length, protected: candidates.length };
  }

  const days = [];
  const seenDays = new Set();
  for (const row of candidates) {
    const day = dayAt(row.observedAt);
    if (day == null || seenDays.has(day)) continue;
    seenDays.add(day);
    days.push(day);
    if (days.length >= MAX_FACT_CHECK_DAYS) break;
  }
  const eligibleDays = new Set(days);
  const factKeys = new Set();
  for (const day of days) {
    const keys = await loadMaterializedFactKeys(minuteDb, day, day + DAY_MS);
    for (const key of keys) factKeys.add(key);
  }

  const checked = candidates.filter((row) => eligibleDays.has(dayAt(row.observedAt)));
  const ids = [];
  for (const row of checked) {
    const minute = minuteAt(row.observedAt);
    if (row.channelId == null || minute == null) continue;
    if (factKeys.has(factKey(row.channelId, minute))) ids.push(row.id);
  }
  return {
    ids,
    scanned: checked.length,
    protected: checked.length - ids.length,
  };
}

function deleteChannelSnapshotIds(db, ids) {
  const safeIds = ids.map(integer).filter((id) => id != null && id > 0);
  if (!safeIds.length) return null;
  return db.prepare(`DELETE FROM sh_channel_snapshots WHERE id IN (${safeIds.join(',')})`);
}

async function pruneMaterializedChannelSnapshots(db, minuteDb, cutoff, size, batches) {
  let deleted = 0;
  let scanned = 0;
  let protectedRows = 0;
  for (let batch = 0; batch < batches; batch += 1) {
    const eligible = await deletableChannelSnapshotIds(db, minuteDb, cutoff, size);
    scanned += eligible.scanned;
    protectedRows += eligible.protected;
    if (!eligible.scanned || !eligible.ids.length) break;
    const statement = deleteChannelSnapshotIds(db, eligible.ids);
    const result = statement ? await statement.run() : null;
    const changes = Number(result?.meta?.changes || 0);
    deleted += changes;
    if (changes === 0 || eligible.scanned < size) break;
  }
  return { deleted, scanned, protected: protectedRows };
}

export async function pruneOldSnapshots(env, now = Date.now()) {
  if (!snapshotRetentionEnabled(env)) return { skipped: true, reason: 'disabled' };
  const db = env?.BUDDIES_DB;
  if (!db?.prepare) return { skipped: true, reason: 'db-binding-missing' };

  const state = await db.prepare(`SELECT last_cleanup_at
    FROM sh_data_maintenance_state WHERE id=?`).bind(STATE_ID).first();
  if (!shouldRunSnapshotRetention(state?.last_cleanup_at, now, env)) {
    return { skipped: true, reason: 'not-due' };
  }

  const missingIndexes = await missingRetentionIndexes(db);
  if (missingIndexes.length) {
    return {
      skipped: true,
      reason: 'retention-indexes-missing',
      missing_indexes: missingIndexes,
    };
  }

  const cutoff = now - retentionMs(env);
  const size = batchSize(env);
  const batches = maxBatches(env);
  const channel = await pruneMaterializedChannelSnapshots(
    db,
    env?.MINUTE_DB,
    cutoff,
    size,
    batches,
  );
  const auxiliary = await pruneTables(db, AUXILIARY_TABLES, cutoff, size, batches);
  const deleted = {
    sh_channel_snapshots: channel.deleted,
    ...auxiliary,
  };

  await db.prepare(`INSERT INTO sh_data_maintenance_state(
      id,last_rollup_key,last_cleanup_at,legacy_backfill_id,updated_at
    ) VALUES(?,NULL,?,0,?) ON CONFLICT(id) DO UPDATE SET
      last_cleanup_at=excluded.last_cleanup_at,
      updated_at=MAX(sh_data_maintenance_state.updated_at,excluded.updated_at)`)
    .bind(STATE_ID, now, now).run();
  return {
    skipped: false,
    cutoff,
    deleted,
    channel_snapshots: {
      scanned: channel.scanned,
      protected_unmaterialized: channel.protected,
    },
  };
}

export async function pruneOldSnapshotsSafely(env, now = Date.now()) {
  try {
    return await pruneOldSnapshots(env, now);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'snapshot_retention_failed',
      error: String(error?.message || error).slice(0, 1000),
    }));
    return { skipped: true, reason: 'retention-error', error: error?.message || String(error) };
  }
}
