import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  AMAZON_MUSIC_DAILY_SCAN_PACING_WINDOW_MS,
  AMAZON_MUSIC_DAILY_SCAN_PAGES_PER_RUN,
  AMAZON_MUSIC_DAILY_SCAN_TARGET_RANK,
  shouldRestartAmazonDaily50k,
} from '../src/amazon-music-daily-50k.js';
import { amazonMusicDueTasks } from '../src/amazon-music-entry.js';
import {
  MUSIC_PLAYLIST_QUEUE_TYPES,
  MUSIC_PLAYLIST_REFRESH_CRON,
  startMusicPlaylistRefresh,
} from '../src/music-playlist-refresh-queue.js';

function config() {
  return JSON.parse(readFileSync(new URL('../wrangler.amazon-music.jsonc', import.meta.url), 'utf8'));
}

function daily50kSource() {
  return readFileSync(new URL('../src/amazon-music-daily-50k.js', import.meta.url), 'utf8');
}

test('music collector receives schedules from the generic dispatcher', () => {
  const value = config();
  const source = readFileSync(new URL('../src/amazon-music-entry.js', import.meta.url), 'utf8');
  assert.equal(value.name, 'sh-amazon-music-collector');
  assert.equal(value.main, 'src/amazon-music-entry.js');
  assert.equal(value.triggers, undefined);
  assert.match(source, /handleInternalScheduled/);
  assert.match(source, /AMAZON_MUSIC_CRON/);
  assert.match(source, /MUSIC_PLAYLIST_REFRESH_CRON/);
  assert.deepEqual(value.d1_databases.map(({ binding }) => binding), ['MINUTE_DB', 'OTHER_DB']);
  assert.equal(value.d1_databases.find(({ binding }) => binding === 'MINUTE_DB')?.database_name, 'stationhead-minute');
  assert.equal(value.d1_databases.find(({ binding }) => binding === 'OTHER_DB')?.database_name, 'stationhead-other');
  assert.deepEqual(value.r2_buckets, [{
    binding: 'PAGES_RESPONSE_R2',
    bucket_name: 'sh-pages-responses',
  }]);
  assert.deepEqual(value.queues.producers, [{ binding: 'MUSIC_PLAYLIST_QUEUE', queue: 'music-playlist-refresh' }]);
  assert.equal(value.queues.consumers[0].queue, 'music-playlist-refresh');
  assert.equal(value.queues.consumers[0].max_batch_size, 1);
  assert.equal(value.queues.consumers[0].max_concurrency, 1);
});

test('Amazon ranking scan is limited to rank 50,000 at up to 1,000 pages per 10-minute run', () => {
  assert.equal(AMAZON_MUSIC_DAILY_SCAN_TARGET_RANK, 50_000);
  assert.equal(AMAZON_MUSIC_DAILY_SCAN_PAGES_PER_RUN, 1_000);
  assert.equal(AMAZON_MUSIC_DAILY_SCAN_PACING_WINDOW_MS, 570_000);
  assert.match(daily50kSource(), /stopRank:\s*AMAZON_MUSIC_DAILY_SCAN_TARGET_RANK/);
});

test('Amazon daily 50k scan starts at 05:00 JST and Apple Music runs daily at 06:00 JST', () => {
  const at = (hour, minute) => Date.UTC(2026, 8, 30, hour, minute, 0);
  const expected = ({ apple = false, daily50kStart = false, daily50kContinue = false } = {}) => ({ apple, daily50kStart, daily50kContinue });
  assert.deepEqual(amazonMusicDueTasks(at(20, 0)), expected({ daily50kStart: true }));
  assert.deepEqual(amazonMusicDueTasks(at(20, 10)), expected({ daily50kContinue: true }));
  assert.deepEqual(amazonMusicDueTasks(at(20, 20)), expected({ daily50kContinue: true }));
  assert.deepEqual(amazonMusicDueTasks(at(21, 0)), expected({ apple: true }));
  assert.deepEqual(amazonMusicDueTasks(at(21, 15)), expected());
  assert.deepEqual(amazonMusicDueTasks(at(23, 50)), expected({ daily50kContinue: true }));
  assert.deepEqual(amazonMusicDueTasks(at(20, 12)), expected());
});

test('active 50k scan restarts only when its Top500 baseline changes', () => {
  const active = { status: 'active', baseline_top500_hash: 'old' };
  assert.equal(shouldRestartAmazonDaily50k(active, 'old'), false);
  assert.equal(shouldRestartAmazonDaily50k(active, 'new'), true);
  assert.equal(shouldRestartAmazonDaily50k({ ...active, status: 'complete' }, 'new'), false);
  assert.equal(shouldRestartAmazonDaily50k({ status: 'active' }, 'new'), false);
});

test('playlist sweeps are Worker-owned and fan out through the bounded queue', async () => {
  assert.equal(MUSIC_PLAYLIST_REFRESH_CRON, '0 5,17 * * *');
  assert.deepEqual(MUSIC_PLAYLIST_QUEUE_TYPES, ['spotify-playlists', 'apple-playlists', 'amazon-track-playlists']);
  const messages = [];
  const result = await startMusicPlaylistRefresh({ MUSIC_PLAYLIST_QUEUE: { send: async (message) => messages.push(message) } }, 1234);
  assert.equal(result.queued, 3);
  assert.deepEqual(messages.map((message) => message.message_type), MUSIC_PLAYLIST_QUEUE_TYPES);
  assert.ok(messages.every((message) => message.run_id === 1234 && message.batch === 0));
});

test('scheduled entry keeps collection orchestration out of the shared Cron dispatcher', () => {
  const source = readFileSync(new URL('../src/amazon-music-entry.js', import.meta.url), 'utf8');
  assert.match(source, /AMAZON_MUSIC_CRON = '0,10,15,20,30,40,50 \* \* \* \*'/);
  assert.match(source, /startMusicPlaylistRefresh/);
  assert.match(source, /queue: runMusicPlaylistQueue/);
  assert.doesNotMatch(source, /AMAZON_MUSIC_TOP_SCAN_CRON/);
  assert.match(source, /amazonMusicServiceEnv\(env\)/);
  assert.match(source, /persistAppleMusicModelToOther\(env, scheduledTime\)/);
  assert.match(source, /persistAmazonMusicModelToOther\(env, scheduledTime\)/);
});

test('Amazon Music bundle participates in Worker checks and deployment', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts['check:bundle'], /check:amazon-music-bundle/);
  assert.match(pkg.scripts['check:amazon-music-bundle'], /wrangler\.amazon-music\.jsonc/);
  assert.equal(pkg.scripts['deploy:amazon-music'], 'node scripts/deploy-amazon-music.mjs');
});
