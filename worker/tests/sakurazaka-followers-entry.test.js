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

test('daily followers reuse the Buddies minute cron and Buddies auth database', () => {
  assert.equal(sakurazakaConfig.main, 'src/sakurazaka-followers-entry.js');
  assert.deepEqual(sakurazakaConfig.triggers?.crons, ['* * * * *']);
  assert.doesNotMatch(sakurazakaEntry, /SAKURAZAKA_QUEUE\.send/);
  assert.match(sakurazakaEntry, /stationhead_daily_followers_legacy_queue_drained/);

  assert.equal(buddiesConfig.main, 'src/buddies-collector-entry.js');
  assert.deepEqual(buddiesConfig.triggers?.crons, ['* * * * *']);
  assert.ok(buddiesConfig.d1_databases.some((item) => item.binding === 'BUDDIES_DB'));
  assert.ok(buddiesConfig.d1_databases.some((item) => item.binding === 'OTHER_DB'));
  assert.match(buddiesEntry, /isJstMidnightMinute\(scheduledAt\)/);
  assert.match(buddiesEntry, /collectStationheadDailyFollowers/);
});

test('daily follower history uses one compact row per JST date', () => {
  assert.match(migration, /observed_date_jst TEXT PRIMARY KEY/);
  assert.match(migration, /sakuramankai INTEGER NOT NULL/);
  assert.match(migration, /sakuramankai2 INTEGER NOT NULL/);
  assert.match(migration, /sakurazaka46jp INTEGER NOT NULL/);
  assert.match(migration, /nogizaka46smej INTEGER NOT NULL/);
  assert.match(migration, /WITHOUT ROWID/);
});
