import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { materializeVariant } from './run-pages-read-model-actions.mjs';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const minuteDatabase = process.env.FACTS_DATABASE_NAME || 'stationhead-minute';
const otherDatabase = process.env.OTHER_DATABASE_NAME || 'stationhead-other';
const variant = Object.freeze({
  key: 'spotify-playcounts',
  url: '/api/spotify-playcounts?artists=sakamichi',
  cadence_minutes: 720,
});

export async function refreshSpotifyReadModel(options = {}) {
  const otherDb = options.otherDb || createWranglerRemoteD1({
    database: otherDatabase,
    cwd: workerRoot,
    wranglerScript,
  });
  const minuteDb = options.minuteDb || createWranglerRemoteD1({
    database: minuteDatabase,
    cwd: workerRoot,
    wranglerScript,
  });
  const revision = async () => {
    const row = await otherDb.prepare(`SELECT
        COALESCE(MAX(chart_date),'') AS chart_date,
        COALESCE(MAX(updated_at),0) AS chart_updated_at
      FROM sh_spotify_artist_chart_daily`).first();
    return `spotify-artist-chart-actions:chart_date=${String(row?.chart_date || '')}:chart_updated_at=${String(row?.chart_updated_at || 0)}`;
  };
  return materializeVariant(
    variant,
    { OTHER_DB: otherDb, MINUTE_DB: minuteDb },
    Number(options.now ?? Date.now()),
    { loadSourceRevision: revision },
  );
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
