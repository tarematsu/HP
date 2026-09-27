import {
  enabled,
  integer,
  logEvent,
  readRun,
  safeText,
  truncateError,
} from './spotify-playcount-common.js';
import { discoverArtistReleases, fetchAnonymousSession } from './spotify-playcount-source.js';
import {
  catalogQueueMessage,
  queueActiveReleases,
  readCollectionArtists,
  refreshArtistCatalog,
  sendCatalogMessage,
} from './spotify-playcount-schedule.js';

function validCatalogMessage(body) {
  if (body?.message_type !== 'spotify-playcount-catalog' || Number(body?.message_version) !== 1) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body?.snapshot_date || ''))) return false;
  if (!safeText(body?.run_token)) return false;
  const index = integer(body?.catalog_index);
  const total = integer(body?.catalog_total);
  if (index == null || index < 0 || total == null || total <= 0 || index >= total) return false;
  return safeText(body?.artist?.artist_key) && safeText(body?.artist?.spotify_artist_id);
}

async function readCatalogRun(db, snapshotDate) {
  return db.prepare(`SELECT run_token,status,catalog_total,catalog_completed
    FROM sh_spotify_collection_runs WHERE snapshot_date=?`)
    .bind(snapshotDate)
    .first();
}

async function recordCatalogError(db, message, error, fatal = false) {
  const statusSql = fatal ? ",status='error'" : '';
  await db.prepare(`UPDATE sh_spotify_collection_runs
    SET errors=errors+1,updated_at=?,last_error=?${statusSql}
    WHERE snapshot_date=? AND run_token=?`)
    .bind(Date.now(), truncateError(error), message.snapshot_date, message.run_token)
    .run();
}

async function advanceCatalog(db, message) {
  const result = await db.prepare(`UPDATE sh_spotify_collection_runs
    SET catalog_completed=catalog_completed+1,updated_at=?,last_error=NULL
    WHERE snapshot_date=? AND run_token=? AND status='catalog'
      AND catalog_total=? AND catalog_completed=?`)
    .bind(
      Date.now(), message.snapshot_date, message.run_token,
      message.catalog_total, message.catalog_index,
    )
    .run();
  return Number(result?.meta?.changes || 0) === 1;
}

async function processCatalogMessage(entry, env, dependencies, session) {
  const message = entry.body;
  const db = env.OTHER_DB;
  const run = await readCatalogRun(db, message.snapshot_date);
  if (!run || run.run_token !== message.run_token || run.status !== 'catalog') {
    entry.ack?.();
    return { ignored: true };
  }

  const cursor = integer(run.catalog_completed) ?? 0;
  if (cursor > message.catalog_index) {
    entry.ack?.();
    return { ignored: true };
  }
  if (cursor < message.catalog_index || Number(run.catalog_total) !== Number(message.catalog_total)) {
    const error = new Error(`Spotify catalog queue cursor mismatch: expected ${cursor}/${run.catalog_total}, got ${message.catalog_index}/${message.catalog_total}`);
    await recordCatalogError(db, message, error, true);
    throw error;
  }

  const artist = {
    artist_key: safeText(message.artist.artist_key),
    spotify_artist_id: safeText(message.artist.spotify_artist_id),
    artist_name: safeText(message.artist.artist_name, message.artist.artist_key),
  };
  const releases = await discoverArtistReleases(
    artist, env, session, dependencies.fetch || fetch,
  );
  const releasesChanged = await refreshArtistCatalog(db, artist, releases, Date.now());

  const advanced = await advanceCatalog(db, message);
  if (!advanced) {
    entry.ack?.();
    return { ignored: true };
  }

  const nextIndex = message.catalog_index + 1;
  try {
    const collectionArtists = await readCollectionArtists(db);
    if (collectionArtists.length !== message.catalog_total) {
      throw new Error(`Spotify collection roster changed during catalog run: ${collectionArtists.length} != ${message.catalog_total}`);
    }

    if (nextIndex < message.catalog_total) {
      await sendCatalogMessage(env, catalogQueueMessage(
        message.snapshot_date,
        message.run_token,
        collectionArtists[nextIndex],
        nextIndex,
        message.catalog_total,
      ));
    } else {
      await queueActiveReleases(env, message.snapshot_date, message.run_token, collectionArtists);
    }
  } catch (error) {
    // The cursor has already advanced. Mark the run retryable instead of silently
    // losing the next queue step if sending the chained message fails.
    await recordCatalogError(db, message, error, true).catch(() => {});
    throw error;
  }

  entry.ack?.();
  logEvent('spotify_playcount_catalog_artist', {
    snapshot_date: message.snapshot_date,
    artist_key: artist.artist_key,
    catalog_index: message.catalog_index,
    catalog_total: message.catalog_total,
    releases_seen: releases.length,
    releases_changed: releasesChanged,
  });
  return { processed: true };
}

export async function processSpotifyCatalogBatch(batch, env, dependencies = {}) {
  if (!enabled(env?.SPOTIFY_PLAYCOUNT_ENABLED, true)) {
    for (const message of batch?.messages || []) message.ack?.();
    return { skipped: true, reason: 'disabled' };
  }
  const db = env?.OTHER_DB;
  if (!db?.prepare || !db?.batch) throw new Error('OTHER_DB binding is required');

  const valid = [];
  let ignored = 0;
  for (const entry of batch?.messages || []) {
    if (!validCatalogMessage(entry?.body)) {
      entry.ack?.();
      ignored += 1;
    } else {
      valid.push(entry);
    }
  }
  if (!valid.length) return { processed: 0, failed: 0, ignored };

  let session;
  try {
    session = dependencies.session || await fetchAnonymousSession(env, dependencies.fetch || fetch);
  } catch (error) {
    for (const entry of valid) entry.retry?.();
    logEvent('spotify_playcount_collection_error', { stage: 'catalog-session', error: truncateError(error, 500) });
    if (!valid.every((entry) => typeof entry.retry === 'function')) throw error;
    return { processed: 0, failed: valid.length, ignored };
  }

  let processed = 0;
  let failed = 0;
  for (const entry of valid) {
    try {
      const result = await processCatalogMessage(entry, env, dependencies, session);
      if (result.ignored) ignored += 1;
      else processed += 1;
    } catch (error) {
      failed += 1;
      const run = await readRun(db, entry.body.snapshot_date).catch(() => null);
      if (run?.status === 'catalog') {
        await recordCatalogError(db, entry.body, error, false).catch(() => {});
      }
      logEvent('spotify_playcount_collection_error', {
        stage: 'catalog',
        snapshot_date: entry.body.snapshot_date,
        artist_key: entry.body.artist?.artist_key,
        error: truncateError(error, 500),
      });
      if (typeof entry.retry === 'function') entry.retry();
      else throw error;
    }
  }
  logEvent('spotify_playcount_catalog_batch', { processed, failed, ignored });
  return { processed, failed, ignored };
}
