import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createWranglerRemoteR2 } from './remote-r2-json-adapter.mjs';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';
import { publishRegionalMusicReadModel } from '../src/regional-music-read-model.js';
import { collectStationheadFollowers } from '../src/stationhead-followers-worker.js';
import { pagesR2ResponseKey } from '../src/pages-response-r2.js';
import { publishNogizakaListeningPartyReadModel } from '../src/nogizaka-pages-read-model.js';

const workerRoot = resolve(import.meta.dirname, '..');
async function bootstrapFollowers(env, now) {
  const date = new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);
  const object = await env.PAGES_RESPONSE_R2.get(pagesR2ResponseKey('followers'));
  const stored = object ? await object.json() : null;
  const payload = typeof stored?.body === 'string' ? JSON.parse(stored.body) : stored;
  if (payload?.ok && payload.latest_date === date) return { skipped: true, reason: 'followers-current', latest_date: date };
  return collectStationheadFollowers(env, now);
}

const producers = {
  'wrangler.scheduled-collection-jobs.jsonc': bootstrapFollowers,
  'wrangler.regional-music.jsonc': publishRegionalMusicReadModel,
  'wrangler.nogizaka46smej.jsonc': publishNogizakaListeningPartyReadModel,
};

// Deployment initializes the response from existing observations. It does not
// invent zero measurements when provider data is absent. Followers catch up
// only when today has not been collected, then resume their daily Worker cron.
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
  const r2 = dependencies.r2 || createWranglerRemoteR2({bucket,cwd:workerRoot,wranglerScript:join(workerRoot,'node_modules/wrangler/bin/wrangler.js')});
  return publish({ OTHER_DB: db, PAGES_RESPONSE_R2: r2 }, dependencies.now ?? Date.now());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await bootstrapProducerReadModel(process.argv[2])));
}
