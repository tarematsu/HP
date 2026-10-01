import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { amazonMusicDueTasks } from '../src/amazon-music-entry.js';

function config() {
  return JSON.parse(readFileSync(new URL('../wrangler.amazon-music.jsonc', import.meta.url), 'utf8'));
}

test('music collector keeps the combined cron and adds a six-minute track-playlist cron', () => {
  const value = config();
  assert.equal(value.name, 'sh-amazon-music-collector');
  assert.equal(value.main, 'src/amazon-music-entry.js');
  assert.deepEqual(value.triggers.crons, [
    '2,5,12,15,22,32,42,52 * * * *',
    '*/6 * * * *',
  ]);
  assert.deepEqual(value.d1_databases.map(({ binding }) => binding), ['MINUTE_DB', 'OTHER_DB']);
  assert.equal(value.d1_databases.find(({ binding }) => binding === 'MINUTE_DB')?.database_name, 'stationhead-minute');
  assert.equal(value.d1_databases.find(({ binding }) => binding === 'OTHER_DB')?.database_name, 'stationhead-other');
  assert.deepEqual(value.r2_buckets, [{
    binding: 'PAGES_RESPONSE_R2',
    bucket_name: 'sh-pages-responses',
  }]);
  assert.equal(value.queues, undefined);
});

test('combined Amazon cron preserves ranking and Apple Music work', () => {
  const at = (hour, minute) => Date.UTC(2026, 8, 30, hour, minute, 0);
  const expected = ({ apple = false, playlists = false, top500 = false, deep100k = false } = {}) => ({
    apple,
    playlists,
    top500,
    deep100k,
  });
  assert.deepEqual(amazonMusicDueTasks(at(3, 2)), expected({ deep100k: true }));
  assert.deepEqual(amazonMusicDueTasks(at(3, 5)), expected({ top500: true }));
  assert.deepEqual(amazonMusicDueTasks(at(3, 12)), expected({ deep100k: true }));
  assert.deepEqual(amazonMusicDueTasks(at(3, 15)), expected({ apple: true }));
  assert.deepEqual(amazonMusicDueTasks(at(18, 15)), expected({ apple: true, playlists: true }));
  assert.deepEqual(amazonMusicDueTasks(at(3, 22)), expected({ deep100k: true }));
  assert.deepEqual(amazonMusicDueTasks(at(3, 6)), expected());
});

test('scheduled entry separates the six-minute playlist lane from other music work', () => {
  const source = readFileSync(new URL('../src/amazon-music-entry.js', import.meta.url), 'utf8');
  assert.match(source, /AMAZON_MUSIC_CRON = '2,5,12,15,22,32,42,52 \* \* \* \*'/);
  assert.match(source, /AMAZON_MUSIC_TRACK_PLAYLIST_CRON = '\*\/6 \* \* \* \*'/);
  assert.match(source, /amazonMusicDueTasks/);
  assert.match(source, /minute === 15/);
  assert.match(source, /getUTCHours\(\) === 18/);
  assert.match(source, /collectAppleMusicPlaylists\(env, scheduledTime\)/);
  assert.match(source, /from '\.\/amazon-music-track-playlist-fetch\.js'/);
  assert.match(source, /cron === AMAZON_MUSIC_TRACK_PLAYLIST_CRON/);
  assert.match(source, /collectAmazonMusicTrackPlaylistData\(env, scheduledTime\)/);
  assert.match(source, /collectAmazonMusicTrackPlaylists\(\s*amazonMusicServiceEnv\(env\),\s*scheduledTime,\s*amazonMusicTrackPlaylistFetch,\s*\)/);
  assert.match(source, /minute === 5/);
  assert.match(source, /minute % 10 === 2/);
  assert.match(source, /amazonMusicServiceEnv\(env\)/);
  assert.match(source, /persistAppleMusicModelToOther\(env, scheduledTime\)/);
  assert.match(source, /persistAmazonMusicModelToOther\(env, scheduledTime\)/);
  assert.doesNotMatch(source, /AMAZON_MUSIC_DAILY_CRON|collectAmazonMusicSnapshot/);
});

test('Amazon Music bundle participates in Worker checks and deployment', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts['check:bundle'], /check:amazon-music-bundle/);
  assert.match(pkg.scripts['check:amazon-music-bundle'], /wrangler\.amazon-music\.jsonc/);
  assert.equal(pkg.scripts['deploy:amazon-music'], 'node scripts/deploy-amazon-music.mjs');
});
