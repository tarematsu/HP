import { collectSpotifyMonthlyListeners } from './spotify-monthly-listeners.js';
import { processSpotifyCatalogBatch } from './spotify-playcount-catalog-consumer.js';
import { processSpotifyPlaycountBatch as processSpotifyAlbumBatch } from './spotify-playcount-consumer.js';
import {
  processSpotifyReadModelRefreshBatch,
  requestSpotifyReadModelRefresh,
  SPOTIFY_READ_MODEL_REFRESH_TYPE,
} from './spotify-pages-read-model.js';

function batchWith(messages) {
  return { messages };
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
  const readModelRefresh = [];
  let ignored = 0;

  for (const entry of batch?.messages || []) {
    const type = entry?.body?.message_type;
    if (type === 'spotify-playcount-catalog') catalog.push(entry);
    else if (type === 'spotify-playcount-album') albums.push(entry);
    else if (type === SPOTIFY_READ_MODEL_REFRESH_TYPE) readModelRefresh.push(entry);
    else {
      entry.ack?.();
      ignored += 1;
    }
  }

  const results = [];
  if (catalog.length) {
    results.push(await processSpotifyCatalogBatch(batchWith(catalog), env, dependencies));
  }
  if (albums.length) {
    const before = await latestCompleteRevision(env?.OTHER_DB);
    results.push(await processSpotifyAlbumBatch(batchWith(albums), env, dependencies));
    const after = await latestCompleteRevision(env?.OTHER_DB);
    if (after?.confirmed && after.revision !== before?.revision) {
      const collectMonthlyListeners = dependencies.collectSpotifyMonthlyListeners
        || collectSpotifyMonthlyListeners;
      try {
        await collectMonthlyListeners(env, after.snapshotDate, dependencies);
      } catch (error) {
        console.error('spotify monthly listener collection failed', error);
      }
      await requestSpotifyReadModelRefresh(env, 'playcount-complete', { source_revision: after.revision });
    }
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
