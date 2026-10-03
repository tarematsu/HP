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

function config() {
  return JSON.parse(readFileSync(new URL('../wrangler.amazon-music.jsonc', import.meta.url), 'utf8'));
}

function daily50kSource() {
  return readFileSync(new URL('../src/amazon-music-daily-50k.js', import.meta.url), 'utf8');
}

function trackPlaylistWorkflow() {
  return readFileSync(new URL('../../.github/workflows/refresh-amazon-music-track-playlists.yml', import.meta.url), 'utf8');
}

function musicServicePlaylistWorkflow() {
  return readFileSync(new URL('../../.github/workflows/refresh-music-service-playlists.yml', import.meta.url), 'utf8');
}

test('music collector keeps one cron while routing daily 50k and Apple work internally', () => {
  const value = config();
  assert.equal(value.name, 'sh-amazon-music-collector');
  assert.equal(value.main, 'src/amazon-music-entry.js');
  assert.deepEqual(value.triggers.crons, ['0,10,15,20,30,40,50 * * * *']);
  assert.deepEqual(value.d1_databases.map(({ binding }) => binding), ['MINUTE_DB', 'OTHER_DB']);
  assert.equal(value.d1_databases.find(({ binding }) => binding === 'MINUTE_DB')?.database_name, 'stationhead-minute');
  assert.equal(value.d1_databases.find(({ binding }) => binding === 'OTHER_DB')?.database_name, 'stationhead-other');
  assert.deepEqual(value.r2_buckets, [{
    binding: 'PAGES_RESPONSE_R2',
    bucket_name: 'sh-pages-responses',
  }]);
  assert.equal(value.queues, undefined);
});

test('Amazon ranking scan is limited to rank 50,000 at up to 1,000 pages per 10-minute run', () => {
  assert.equal(AMAZON_MUSIC_DAILY_SCAN_TARGET_RANK, 50_000);
  assert.equal(AMAZON_MUSIC_DAILY_SCAN_PAGES_PER_RUN, 1_000);
  assert.equal(AMAZON_MUSIC_DAILY_SCAN_PACING_WINDOW_MS, 570_000);
  assert.match(daily50kSource(), /stopRank:\s*AMAZON_MUSIC_DAILY_SCAN_TARGET_RANK/);
});

test('Amazon daily 50k scan starts at 05:00 JST and continues every 10 minutes', () => {
  const at = (hour, minute) => Date.UTC(2026, 8, 30, hour, minute, 0);
  const expected = ({ apple = false, daily50kStart = false, daily50kContinue = false } = {}) => ({
    apple,
    daily50kStart,
    daily50kContinue,
  });

  assert.deepEqual(amazonMusicDueTasks(at(20, 0)), expected({ daily50kStart: true }));
  assert.deepEqual(amazonMusicDueTasks(at(20, 10)), expected({ daily50kContinue: true }));
  assert.deepEqual(amazonMusicDueTasks(at(20, 20)), expected({ daily50kContinue: true }));
  assert.deepEqual(amazonMusicDueTasks(at(23, 50)), expected({ daily50kContinue: true }));
  assert.deepEqual(amazonMusicDueTasks(at(20, 12)), expected());
  assert.deepEqual(amazonMusicDueTasks(at(17, 0)), expected());
  assert.deepEqual(amazonMusicDueTasks(at(3, 5)), expected());
  assert.deepEqual(amazonMusicDueTasks(at(3, 15)), expected({ apple: true }));
  assert.deepEqual(amazonMusicDueTasks(at(0, 10)), expected());
});

test('active 50k scan restarts only when its Top500 baseline changes', () => {
  const active = { status: 'active', baseline_top500_hash: 'old' };
  assert.equal(shouldRestartAmazonDaily50k(active, 'old'), false);
  assert.equal(shouldRestartAmazonDaily50k(active, 'new'), true);
  assert.equal(shouldRestartAmazonDaily50k({ ...active, status: 'complete' }, 'new'), false);
  assert.equal(shouldRestartAmazonDaily50k({ status: 'active' }, 'new'), false);
});

test('scheduled entry leaves every playlist sweep to Actions', () => {
  const source = readFileSync(new URL('../src/amazon-music-entry.js', import.meta.url), 'utf8');
  assert.match(source, /AMAZON_MUSIC_CRON = '0,10,15,20,30,40,50 \* \* \* \*'/);
  assert.doesNotMatch(source, /AMAZON_MUSIC_TOP_SCAN_CRON/);
  assert.doesNotMatch(source, /amazon-music-top-500-monitor/);
  assert.doesNotMatch(source, /checkAmazonUpdateAndQueue100k/);
  assert.doesNotMatch(source, /continueAmazon150kExtension/);
  assert.doesNotMatch(source, /AMAZON_MUSIC_TRACK_PLAYLIST_CRON/);
  assert.doesNotMatch(source, /amazon-music-track-playlist-fetch/);
  assert.doesNotMatch(source, /collectAmazonMusicTrackPlaylists/);
  assert.doesNotMatch(source, /collectAppleMusicPlaylists/);
  assert.match(source, /amazonMusicServiceEnv\(env\)/);
  assert.match(source, /persistAppleMusicModelToOther\(env, scheduledTime\)/);
  assert.match(source, /persistAmazonMusicModelToOther\(env, scheduledTime\)/);
  assert.doesNotMatch(source, /collectAmazonMusicSnapshot/);
});

test('Amazon track-playlist Action runs full sweeps at 02:00 and 14:00 JST only', () => {
  const source = trackPlaylistWorkflow();
  assert.match(source, /schedule:\s*\n\s*#.*02:00 JST.*14:00 JST[\s\S]*cron: '0 5,17 \* \* \*'/);
  assert.match(source, /workflow_dispatch:/);
  assert.doesNotMatch(source, /^\s*push:/m);
  assert.match(source, /processed >= target/);
  assert.match(source, /timeout-minutes: 60/);
});

test('Spotify and Apple playlist Action uses the same twice-daily full-sweep cadence', () => {
  const source = musicServicePlaylistWorkflow();
  assert.match(source, /schedule:\s*\n\s*#.*02:00 JST.*14:00 JST[\s\S]*cron: '0 5,17 \* \* \*'/);
  assert.match(source, /run_sweep spotify true/);
  assert.match(source, /run_sweep apple false/);
  assert.match(source, /processed >= target/);
  assert.match(source, /timeout-minutes: 60/);
});

test('Amazon Music bundle participates in Worker checks and deployment', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts['check:bundle'], /check:amazon-music-bundle/);
  assert.match(pkg.scripts['check:amazon-music-bundle'], /wrangler\.amazon-music\.jsonc/);
  assert.equal(pkg.scripts['deploy:amazon-music'], 'node scripts/deploy-amazon-music.mjs');
});
