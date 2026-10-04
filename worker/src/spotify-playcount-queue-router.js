import { collectSpotifyMonthlyListeners } from './spotify-monthly-listeners.js';
import { processSpotifyCatalogBatch } from './spotify-playcount-catalog-consumer.js';
import { processSpotifyPlaycountBatch as processSpotifyAlbumBatch } from './spotify-playcount-consumer.js';
import {
  processSpotifyReadModelRefreshBatch,
  requestSpotifyReadModelRefresh,
  SPOTIFY_READ_MODEL_REFRESH_TYPE,
} from './spotify-pages-read-model.js';
import {
  processSpotifyScheduledDispatchEntry,
  SPOTIFY_SCHEDULED_DISPATCH_TYPE,
} from './spotify-scheduled-queue.js';

export const SPOTIFY_MONTHLY_LISTENERS_TYPE = 'spotify-monthly-listeners';
export const SPOTIFY_ALBUM_BATCH_TYPE = 'spotify-playcount-album-batch';

function batchWith(messages) {
  return { messages };
}

function expandAlbumBatchEntry(entry) {
  const body = entry?.body;
  if (body?.message_type !== SPOTIFY_ALBUM_BATCH_TYPE
      || Number(body?.message_version) !== 1
      || !Array.isArray(body?.albums)
      || body.albums.length === 0) return null;
  const state = { retry: false };
  return {
    state,
    messages: body.albums.map((album) => ({
      body: album,
      ack: () => {},
      retry: () => { state.retry = true; },
    })),
  };
}

export function spotifyMonthlyListenerRetryDelaySeconds(attempt) {
  const normalized = Math.max(1, Math.trunc(Number(attempt) || 1));
  const exponent = Math.min(6, normalized - 1);
  return Math.min(3600, 60 * (2 ** exponent));
}

async function scheduleSpotifyMonthlyListenerRetry(
  env,
  snapshotDate,
  sourceRevision,
  attempt,
  dependencies = {},
) {
  const queue = dependencies.spotifyPlaycountQueue || env?.SPOTIFY_PLAYCOUNT_QUEUE;
  if (!queue?.send) throw new Error('SPOTIFY_PLAYCOUNT_QUEUE is unavailable');
  const nextAttempt = Math.max(1, Math.trunc(Number(attempt) || 1));
  await queue.send({
    message_type: SPOTIFY_MONTHLY_LISTENERS_TYPE,
    snapshot_date: snapshotDate,
    source_revision: sourceRevision || null,
    attempt: nextAttempt,
  }, {
    delaySeconds: spotifyMonthlyListenerRetryDelaySeconds(nextAttempt),
  });
}

async function collectMonthlyListenersAfterPlaycount(env, revision, dependencies = {}) {
  const collectMonthlyListeners = dependencies.collectSpotifyMonthlyListeners
    || collectSpotifyMonthlyListeners;
  try {
    const result = await collectMonthlyListeners(env, revision.snapshotDate, dependencies);
    if (Number(result?.failed || 0) <= 0) return;
    await scheduleSpotifyMonthlyListenerRetry(
      env,
      revision.snapshotDate,
      revision.revision,
      1,
      dependencies,
    );
    console.error('spotify monthly listener collection incomplete; retry scheduled', {
      snapshot_date: revision.snapshotDate,
      failed: Number(result?.failed || 0),
    });
  } catch (error) {
    try {
      await scheduleSpotifyMonthlyListenerRetry(
        env,
        revision.snapshotDate,
        revision.revision,
        1,
        dependencies,
      );
      console.error('spotify monthly listener collection failed; retry scheduled', error);
    } catch (scheduleError) {
      console.error('spotify monthly listener collection and retry scheduling failed', {
        collection_error: String(error),
        schedule_error: String(scheduleError),
      });
    }
  }
}

async function processSpotifyMonthlyListenerRetryEntry(entry, env, dependencies = {}) {
  const snapshotDate = String(entry?.body?.snapshot_date || '');
  const sourceRevision = String(entry?.body?.source_revision || '');
  const attempt = Math.max(1, Math.trunc(Number(entry?.body?.attempt) || 1));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
    entry.ack?.();
    return { processed: 0, failed: 0, ignored: 1 };
  }

  const collectMonthlyListeners = dependencies.collectSpotifyMonthlyListeners
    || collectSpotifyMonthlyListeners;
  try {
    const result = await collectMonthlyListeners(env, snapshotDate, {
      ...dependencies,
      missingOnly: true,
    });
    if (Number(result?.failed || 0) > 0) {
      throw new Error(`Spotify monthly listeners still missing for ${Number(result.failed)} artist(s)`);
    }
    await requestSpotifyReadModelRefresh(env, 'monthly-listeners-complete', {
      snapshot_date: snapshotDate,
      source_revision: sourceRevision || null,
      retry_attempt: attempt,
    });
    entry.ack?.();
    return { processed: 1, failed: 0, ignored: 0 };
  } catch (error) {
    try {
      await scheduleSpotifyMonthlyListenerRetry(
        env,
        snapshotDate,
        sourceRevision,
        attempt + 1,
        dependencies,
      );
      entry.ack?.();
      console.error('spotify monthly listener retry deferred', {
        snapshot_date: snapshotDate,
        attempt,
        error: String(error),
      });
      return { processed: 1, failed: 0, ignored: 0 };
    } catch (scheduleError) {
      entry.retry?.();
      console.error('spotify monthly listener retry scheduling failed', {
        snapshot_date: snapshotDate,
        attempt,
        collection_error: String(error),
        schedule_error: String(scheduleError),
      });
      return { processed: 0, failed: 1, ignored: 0 };
    }
  }
}

async function latestCompleteRevision(db) {
  if (!db?.prepare) return null;
  const row = await db.prepare(`SELECT snapshot_date,run_token,tracks_collected,completed_at,updated_at
    FROM sh_spotify_collection_runs
    WHERE status='complete'
    ORDER BY snapshot_date DESC
    LIMIT 1`).first();
  if (!row?.snapshot_date) return null;
  return {
    snapshotDate: String(row.snapshot_date),
    revision: [
      String(row.snapshot_date),
      Number(row.tracks_collected || 0),
      Number(row.completed_at || 0),
      Number(row.updated_at || 0),
    ].join(':'),
    confirmed: String(row.run_token || '').endsWith(':confirm'),
  };
}

export async function processSpotifyPlaycountBatch(batch, env, dependencies = {}) {
  const catalog = [];
  const albums = [];
  const albumBatches = [];
  const monthlyListeners = [];
  const readModelRefresh = [];
  const scheduledDispatches = [];
  let ignored = 0;

  for (const entry of batch?.messages || []) {
    const type = entry?.body?.message_type;
    if (type === 'spotify-playcount-catalog') catalog.push(entry);
    else if (type === 'spotify-playcount-album') albums.push(entry);
    else if (type === SPOTIFY_ALBUM_BATCH_TYPE) albumBatches.push(entry);
    else if (type === SPOTIFY_MONTHLY_LISTENERS_TYPE) monthlyListeners.push(entry);
    else if (type === SPOTIFY_READ_MODEL_REFRESH_TYPE) readModelRefresh.push(entry);
    else if (type === SPOTIFY_SCHEDULED_DISPATCH_TYPE) scheduledDispatches.push(entry);
    else {
      entry.ack?.();
      ignored += 1;
    }
  }

  const results = [];
  for (const entry of scheduledDispatches) {
    results.push(await processSpotifyScheduledDispatchEntry(entry, env, dependencies));
  }
  if (catalog.length) {
    results.push(await processSpotifyCatalogBatch(batchWith(catalog), env, dependencies));
  }

  const expandedAlbumEntries = [...albums];
  const expandedStates = [];
  for (const entry of albumBatches) {
    const expanded = expandAlbumBatchEntry(entry);
    if (!expanded) {
      entry.ack?.();
      ignored += 1;
      continue;
    }
    expandedAlbumEntries.push(...expanded.messages);
    expandedStates.push({ entry, state: expanded.state });
  }

  if (expandedAlbumEntries.length) {
    const before = await latestCompleteRevision(env?.OTHER_DB);
    results.push(await processSpotifyAlbumBatch(batchWith(expandedAlbumEntries), env, dependencies));
    for (const { entry, state } of expandedStates) {
      if (state.retry) entry.retry?.();
      else entry.ack?.();
    }
    const after = await latestCompleteRevision(env?.OTHER_DB);
    if (after?.confirmed && after.revision !== before?.revision) {
      await collectMonthlyListenersAfterPlaycount(env, after, dependencies);
      await requestSpotifyReadModelRefresh(env, 'playcount-complete', { source_revision: after.revision });
    }
  }
  for (const entry of monthlyListeners) {
    results.push(await processSpotifyMonthlyListenerRetryEntry(entry, env, dependencies));
  }
  if (readModelRefresh.length) {
    results.push(await processSpotifyReadModelRefreshBatch(batchWith(readModelRefresh), env));
  }

  return results.reduce((total, result) => ({
    processed: total.processed + Number(result?.processed || 0),
    failed: total.failed + Number(result?.failed || 0),
    ignored: total.ignored + Number(result?.ignored || 0),
  }), { processed: 0, failed: 0, ignored });
}
