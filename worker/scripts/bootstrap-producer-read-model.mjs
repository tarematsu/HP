import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runWrangler } from './cloudflare-queues.mjs';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';
import { publishRegionalMusicReadModel } from '../src/regional-music-read-model.js';
import { publishNogizakaListeningPartyReadModel } from '../src/nogizaka-pages-read-model.js';

const workerRoot = resolve(import.meta.dirname, '..');
const producers = {
  'wrangler.regional-music.jsonc': publishRegionalMusicReadModel,
  'wrangler.nogizaka46smej.jsonc': publishNogizakaListeningPartyReadModel,
};

// Deployment initializes the response from existing observations. It does not
// invoke collectors or invent zero measurements when provider data is absent.
export async function bootstrapProducerReadModel(configName, dependencies = {}) {
  const publish = producers[configName];
  if (!publish) throw new Error(`Unsupported producer configuration: ${configName}`);
  const config = dependencies.config || JSON.parse(readFileSync(join(workerRoot, configName), 'utf8'));
  const database = config.d1_databases.find(({ binding }) => binding === 'OTHER_DB')?.database_name;
  const bucket = config.r2_buckets.find(({ binding }) => binding === 'PAGES_RESPONSE_R2')?.bucket_name;
  if (!database || !bucket) throw new Error('Producer database and response bucket are required');
  const db = dependencies.db || createWranglerRemoteD1({
    database, cwd: workerRoot,
    wranglerScript: join(workerRoot, 'node_modules/wrangler/bin/wrangler.js'),
    tempPrefix: '.producer-read-model-',
  });
  const r2 = dependencies.r2 || {
    async put(key, body) {
      const directory = mkdtempSync(join(tmpdir(), 'producer-read-model-'));
      try {
        const path = join(directory, 'response.json');
        writeFileSync(path, body, 'utf8');
        runWrangler(['r2', 'object', 'put', `${bucket}/${key}`, '--remote', '--file', path,
          '--content-type', 'application/json; charset=utf-8'], { capture: true });
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  };
  return publish({ OTHER_DB: db, PAGES_RESPONSE_R2: r2 }, dependencies.now ?? Date.now());
}
