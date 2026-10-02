import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

import { runPagesReadModelActions } from './run-pages-read-model-actions.mjs';

export async function refreshSpotifyReadModel() {
  const result = await runPagesReadModelActions({
    dueKeys: ['spotify-playcounts'],
    retryOverdue: false,
  });
  const published = result.published.find((item) => item.key === 'spotify-playcounts');
  if (!published) throw new Error('Spotify read model was not published');
  return published;
}

async function main() {
  const published = await refreshSpotifyReadModel();
  console.log(JSON.stringify({
    ok: true,
    event: 'spotify_read_model_refreshed',
    object_key: published.object_key,
    changed: published.changed,
    rendered: published.rendered,
    source_revision: published.source_revision,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      event: 'spotify_read_model_refresh_failed',
      error: String(error?.message || error),
    }));
    process.exitCode = 1;
  });
}
