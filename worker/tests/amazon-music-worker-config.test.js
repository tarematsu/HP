import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { amazonMusicDueTasks } from '../src/amazon-music-entry.js';

function config() {
  return JSON.parse(readFileSync(new URL('../wrangler.amazon-music.jsonc', import.meta.url), 'utf8'));
}

function trackPlaylistWorkflow() {
  return readFileSync(new URL('../../.github/workflows/refresh-amazon-music-track-playlists.yml', import.meta.url), 'utf8');
}

function musicServicePlaylistWorkflow() {
  return readFileSync(new URL('../../.github/workflows/refresh-music-service-playlists.yml', import.meta.url), 'utf8');
}

test('music collector keeps one combined Worker cron', () => {
  const value = config();
  assert.equal(value.name, 'sh-amazon-music-collector');
  assert.equal(value.main, 'src/amazon-music-entry.js');
  assert.deepEqual(value.triggers.crons, ['2,5,12,15,22,32,42,52 * * * *']);
  assert.deepEqual(value.d1_databases.map(({ binding }) => binding), ['MINUTE_DB', 'OTHER_DB']);
  assert.equal(value.d1_databases.find(({ binding }) => binding === 'MINUTE_DB')?.database_name, 'stationhead-minute');
  assert.equal(value.d1_databases.find(({ binding }) => binding === 'OTHER_DB')?.database_name, 'stationhead-other');
  assert.deepEqual(value.r2_buckets, [{
    binding: 'PAGES_RESPONSE_R2',
    bucket_name: 'sh-pages-responses',
  }]);
  assert.equal(value.queues, undefined);
});

test('combined Amazon cron preserves ranking and Apple Music ranking work only', () => {
  const at = (hour, minute) => Date.UTC(2026, 8, 30, hour, minute, 0);
  const expected = ({ apple = false, top500 = false, deep100k = false } = {}) => ({
    apple,
    top500,
    deep100k,
  });
  assert.deepEqual(amazonMusicDueTasks(at(3, 2)), expected({ deep100k: true }));
  assert.deepEqual(amazonMusicDueTasks(at(3, 5)), expected({ top500: true }));
  assert.deepEqual(amazonMusicDueTasks(at(3, 12)), expected({ deep100k: true }));
  assert.deepEqual(amazonMusicDueTasks(at(3, 15)), expected({ apple: true }));
  assert.deepEqual(amazonMusicDueTasks(at(18, 15)), expected({ apple: true }));
  assert.deepEqual(amazonMusicDueTasks(at(3, 22)), expected({ deep100k: true }));
  assert.deepEqual(amazonMusicDueTasks(at(3, 6)), expected());
});

test('scheduled entry leaves every playlist sweep to Actions', () => {
  const source = readFileSync(new URL('../src/amazon-music-entry.js', import.meta.url), 'utf8');
  assert.match(source, /AMAZON_MUSIC_CRON = '2,5,12,15,22,32,42,52 \* \* \* \*'/);
  assert.doesNotMatch(source, /AMAZON_MUSIC_TRACK_PLAYLIST_CRON/);
  assert.doesNotMatch(source, /amazon-music-track-playlist-fetch/);
  assert.doesNotMatch(source, /collectAmazonMusicTrackPlaylists/);
  assert.doesNotMatch(source, /collectAppleMusicPlaylists/);
  assert.doesNotMatch(source, /getUTCHours\(\) === 18/);
  assert.match(source, /amazonMusicDueTasks/);
  assert.match(source, /minute === 15/);
  assert.match(source, /minute === 5/);
  assert.match(source, /minute % 10 === 2/);
  assert.match(source, /amazonMusicServiceEnv\(env\)/);
  assert.match(source, /persistAppleMusicModelToOther\(env, scheduledTime\)/);
  assert.match(source, /persistAmazonMusicModelToOther\(env, scheduledTime\)/);
  assert.doesNotMatch(source, /AMAZON_MUSIC_DAILY_CRON|collectAmazonMusicSnapshot/);
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
