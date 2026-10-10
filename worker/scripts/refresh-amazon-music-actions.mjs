import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';
import { createWranglerRemoteR2 } from './remote-r2-json-adapter.mjs';
import { startAmazonDaily50kScan, continueAmazonDaily50kScan, AMAZON_MUSIC_DAILY_SCAN_STATE_KEY } from '../src/amazon-music-daily-50k.js';
import { amazonMusicServiceEnv } from '../src/music-service-other-store.js';

const GROUPS = ['乃木坂46', '櫻坂46', '日向坂46'];

export async function refreshAmazonModel(env, { now = Date.now(), dependencies = {} } = {}) {
  const serviceEnv = amazonMusicServiceEnv(env);
  let resumeState = null;
  if (!dependencies.collect) {
    const object = await env.PAGES_RESPONSE_R2?.get(AMAZON_MUSIC_DAILY_SCAN_STATE_KEY);
    const state = await object?.json();
    const sourceAt = Number(state?.started_at || state?.updated_at);
    if (sourceAt > 0 && sourceAt <= now && now - sourceAt < 36 * 60 * 60_000
        && (state.status === 'active' || state.publication_pending)) resumeState = state;
  }
  const expectedObservedAt = resumeState?.complete ? Number(resumeState.updated_at) : now;
  let scan = resumeState
    ? await (dependencies.continue || continueAmazonDaily50kScan)(serviceEnv, now)
    : await (dependencies.collect || startAmazonDaily50kScan)(serviceEnv, now);
  let batches = 1;
  while (!scan.complete && scan.ok && scan.skipped === false && batches < 6) {
    const before = Number(scan.scanned_tracks) || 0;
    scan = await (dependencies.continue || continueAmazonDaily50kScan)(serviceEnv, now);
    batches++;
    if (!scan.complete && Number(scan.scanned_tracks) <= before) {
      throw new Error(`Amazon Music recollection made no progress (tracks=${before})`);
    }
  }
  if (!scan.complete || !scan.published?.published) {
    throw new Error(`Amazon Music recollection did not publish a complete scan (tracks=${scan.scanned_tracks ?? 'unknown'})`);
  }
  const object = await env.PAGES_RESPONSE_R2.get('amazon-music/read-model/latest.json');
  const model = await object?.json();
  if (!model || model.observed_at !== expectedObservedAt) throw new Error('Amazon Music recollection publication is not current');
  return { ...scan.published, scan, groups: Object.fromEntries(GROUPS.map((group) => [
    group, (model.tracks || []).filter((track) => track.group_name === group && track.amazon_rank != null).length,
  ])) };
}

export async function runAmazonMusicRefresh() {
  const root = resolve(import.meta.dirname, '..');
  const config = JSON.parse(readFileSync(join(root, 'wrangler.amazon-music.jsonc'), 'utf8'));
  const wranglerScript = join(root, 'node_modules/wrangler/bin/wrangler.js');
  const database = (binding) => createWranglerRemoteD1({
    database: config.d1_databases.find((row) => row.binding === binding)?.database_name,
    cwd: root, wranglerScript,
  });
  const env = {
    MINUTE_DB: database('MINUTE_DB'),
    OTHER_DB: database('OTHER_DB'),
    PAGES_RESPONSE_R2: createWranglerRemoteR2({
      bucket: config.r2_buckets.find((row) => row.binding === 'PAGES_RESPONSE_R2')?.bucket_name,
      cwd: root, wranglerScript,
    }),
  };
  console.log(JSON.stringify({ event: 'amazon_music_refresh_started', target_rank: 50_000 }));
  const result = await refreshAmazonModel(env);
  if (result?.published !== true || GROUPS.some((group) => !Object.hasOwn(result.groups || {}, group))) {
    throw new Error('Amazon Music publication did not include all three groups');
  }
  console.log(JSON.stringify({ event: 'amazon_music_read_model_refreshed', ...result }));
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runAmazonMusicRefresh().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }));
    process.exitCode = 1;
  });
}

