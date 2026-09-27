import { processSpotifyCatalogBatch } from './spotify-playcount-catalog-consumer.js';
import { processSpotifyPlaycountBatch as processSpotifyAlbumBatch } from './spotify-playcount-consumer.js';

function batchWith(messages) {
  return { messages };
}

export async function processSpotifyPlaycountBatch(batch, env, dependencies = {}) {
  const catalog = [];
  const albums = [];
  let ignored = 0;

  for (const entry of batch?.messages || []) {
    const type = entry?.body?.message_type;
    if (type === 'spotify-playcount-catalog') catalog.push(entry);
    else if (type === 'spotify-playcount-album') albums.push(entry);
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
    results.push(await processSpotifyAlbumBatch(batchWith(albums), env, dependencies));
  }

  return results.reduce((total, result) => ({
    processed: total.processed + Number(result?.processed || 0),
    failed: total.failed + Number(result?.failed || 0),
    ignored: total.ignored + Number(result?.ignored || 0),
  }), { processed: 0, failed: 0, ignored });
}
