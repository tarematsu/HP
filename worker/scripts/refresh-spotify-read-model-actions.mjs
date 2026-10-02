import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { publishSpotifyPagesReadModel } from '../src/spotify-pages-read-model.js';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';
import { createWranglerRemoteR2 } from './remote-r2-json-adapter.mjs';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const otherDatabase = process.env.OTHER_DATABASE_NAME || 'stationhead-other';
const responseBucket = process.env.PAGES_RESPONSE_BUCKET || 'sh-pages-responses';

function actionsR2() {
  const remote = createWranglerRemoteR2({
    bucket: responseBucket,
    cwd: workerRoot,
    wranglerScript,
  });
  return {
    async get(key) {
      const object = await remote.get(key);
      if (!object) return null;
      const value = await object.json();
      return { text: async () => JSON.stringify(value) };
    },
    async put(key, body) {
      await remote.put(key, body);
    },
  };
}

export async function refreshSpotifyReadModel(options = {}) {
  const otherDb = options.otherDb || createWranglerRemoteD1({
    database: otherDatabase,
    cwd: workerRoot,
    wranglerScript,
  });
  const r2 = options.r2 || actionsR2();
  return publishSpotifyPagesReadModel(
    { OTHER_DB: otherDb, PAGES_RESPONSE_R2: r2 },
    { now: Number(options.now ?? Date.now()) },
  );
}

async function main() {
  const published = await refreshSpotifyReadModel();
  console.log(JSON.stringify({
    ok: true,
    event: 'spotify_read_model_refreshed',
    ...published,
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
