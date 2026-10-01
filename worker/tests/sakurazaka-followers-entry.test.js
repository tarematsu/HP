import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sakurazakaConfig = JSON.parse(readFileSync(new URL('../wrangler.sakurazaka46jp.jsonc', import.meta.url), 'utf8'));
const sakurazakaEntry = readFileSync(new URL('../src/sakurazaka-followers-entry.js', import.meta.url), 'utf8');
const buddiesConfig = JSON.parse(readFileSync(new URL('../wrangler.buddies-collector.jsonc', import.meta.url), 'utf8'));
const buddiesEntry = readFileSync(new URL('../src/buddies-collector-entry.js', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../../database/other-migrations/055_stationhead_daily_followers.sql', import.meta.url),
  'utf8',
);

test('Sakurazaka minute cron is the shared scheduler while Buddies stays independent', () => {
  assert.equal(sakurazakaConfig.main, 'src/sakurazaka-followers-entry.js');
  assert.deepEqual(sakurazakaConfig.triggers?.crons, ['* * * * *']);
  assert.deepEqual(sakurazakaConfig.services, [
    { binding: 'NOGIZAKA_SCHEDULED', service: 'sh-nogizaka46smej' },
    { binding: 'OHISAMA_SCHEDULED', service: 'sh-ohisama-collector' },
    { binding: 'SPOTIFY_PLAYCOUNT_SCHEDULED', service: 'sh-spotify-playcount-collector' },
  ]);
  assert.ok(sakurazakaConfig.queues?.producers?.some((item) => (
    item.binding === 'REGIONAL_MUSIC_QUEUE' && item.queue === 'regional-music-daily'
  )));
  assert.match(sakurazakaEntry, /dispatchScheduledService/);
  assert.match(sakurazakaEntry, /enqueueRegionalMusicDispatch/);
  assert.match(sakurazakaEntry, /minute % 5 === 1/);
  assert.match(sakurazakaEntry, /Buddies owns the 00\/05\/10/);
  assert.match(sakurazakaEntry, /minute === 0/);
  assert.doesNotMatch(sakurazakaEntry, /SAKURAZAKA_QUEUE\.send/);
  assert.match(sakurazakaEntry, /stationhead_daily_followers_legacy_queue_drained/);

  assert.equal(buddiesConfig.main, 'src/buddies-collector-entry.js');
  assert.deepEqual(buddiesConfig.triggers?.crons, ['*/5 * * * *']);
  assert.ok(buddiesConfig.d1_databases.some((item) => item.binding === 'BUDDIES_DB'));
  assert.ok(buddiesConfig.d1_databases.some((item) => item.binding === 'OTHER_DB'));
  assert.match(buddiesEntry, /isJstFollowerCollectionMinute\(scheduledAt\)/);
  assert.match(buddiesEntry, /collectStationheadDailyFollowersResilient/);
});

test('daily follower history uses one compact row per JST date', () => {
  assert.match(migration, /observed_date_jst TEXT PRIMARY KEY/);
  assert.match(migration, /sakuramankai INTEGER NOT NULL/);
  assert.match(migration, /sakuramankai2 INTEGER NOT NULL/);
  assert.match(migration, /sakurazaka46jp INTEGER NOT NULL/);
  assert.match(migration, /nogizaka46smej INTEGER NOT NULL/);
  assert.match(migration, /WITHOUT ROWID/);
});
