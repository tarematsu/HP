import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { shouldDispatchSpotifyPlaycount } from '../src/spotify-playcount-timing.js';

const sakurazakaConfig = JSON.parse(readFileSync(new URL('../wrangler.sakurazaka46jp.jsonc', import.meta.url), 'utf8'));
const sakurazakaEntry = readFileSync(new URL('../src/sakurazaka-followers-entry.js', import.meta.url), 'utf8');
const buddiesConfig = JSON.parse(readFileSync(new URL('../wrangler.buddies-collector.jsonc', import.meta.url), 'utf8'));
const buddiesEntry = readFileSync(new URL('../src/buddies-collector-entry.js', import.meta.url), 'utf8');
const collectionJobs = readFileSync(new URL('../src/scheduled-collection-jobs-entry.js', import.meta.url), 'utf8');
const dispatcher = readFileSync(new URL('../src/cron-dispatcher-entry.js', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../../database/other-migrations/055_stationhead_daily_followers.sql', import.meta.url),
  'utf8',
);

test('Sakurazaka and Buddies each keep an independent collection cron', () => {
  assert.equal(sakurazakaConfig.main, 'src/sakurazaka-followers-entry.js');
  assert.deepEqual(sakurazakaConfig.triggers?.crons, ['* * * * *']);
  assert.equal(sakurazakaConfig.services, undefined);
  assert.equal(sakurazakaConfig.queues?.producers?.some((item) => item.binding === 'REGIONAL_MUSIC_QUEUE'), false);
  assert.match(sakurazakaEntry, /SAKURAZAKA_CRON = '\* \* \* \* \*'/);
  assert.doesNotMatch(sakurazakaEntry, /dispatchScheduledService/);
  assert.doesNotMatch(sakurazakaEntry, /enqueueRegionalMusicDispatch/);
  assert.doesNotMatch(sakurazakaEntry, /shouldDispatchSpotify/);
  assert.match(sakurazakaEntry, /stationhead_daily_followers_legacy_queue_drained/);

  assert.equal(buddiesConfig.main, 'src/buddies-collector-entry.js');
  assert.deepEqual(buddiesConfig.triggers?.crons, ['*/5 * * * *']);
  assert.ok(buddiesConfig.d1_databases.some((item) => item.binding === 'BUDDIES_DB'));
  assert.ok(buddiesConfig.d1_databases.some((item) => item.binding === 'OTHER_DB'));
  assert.doesNotMatch(buddiesEntry, /isJstFollowerCollectionMinute/);
  assert.doesNotMatch(buddiesEntry, /collectStationheadDailyFollowersResilient/);

  assert.match(collectionJobs, /STATIONHEAD_FOLLOWERS_CRON = '0 15 \* \* \*'/);
  assert.match(collectionJobs, /collectStationheadFollowers/);
  assert.match(dispatcher, /stationhead-followers/);
});

test('Spotify checks every ten minutes from 00:00 through 04:50 JST and hourly otherwise', () => {
  assert.equal(shouldDispatchSpotifyPlaycount(Date.parse('2026-10-02T14:50:00Z')), false);
  assert.equal(shouldDispatchSpotifyPlaycount(Date.parse('2026-10-02T15:00:00Z')), true);
  assert.equal(shouldDispatchSpotifyPlaycount(Date.parse('2026-10-02T15:10:00Z')), true);
  assert.equal(shouldDispatchSpotifyPlaycount(Date.parse('2026-10-02T19:50:00Z')), true);
  assert.equal(shouldDispatchSpotifyPlaycount(Date.parse('2026-10-02T20:00:00Z')), true);
  assert.equal(shouldDispatchSpotifyPlaycount(Date.parse('2026-10-02T20:10:00Z')), false);
  assert.equal(shouldDispatchSpotifyPlaycount(Date.parse('2026-10-03T03:00:00Z')), true);
});

test('daily follower history uses one compact row per JST date', () => {
  assert.match(migration, /observed_date_jst TEXT PRIMARY KEY/);
  assert.match(migration, /sakuramankai INTEGER NOT NULL/);
  assert.match(migration, /sakuramankai2 INTEGER NOT NULL/);
  assert.match(migration, /sakurazaka46jp INTEGER NOT NULL/);
  assert.match(migration, /nogizaka46smej INTEGER NOT NULL/);
  assert.match(migration, /WITHOUT ROWID/);
});
