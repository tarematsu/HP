import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = JSON.parse(readFileSync(new URL('../wrangler.sakurazaka46jp.jsonc', import.meta.url), 'utf8'));
const entry = readFileSync(new URL('../src/sakurazaka-followers-entry.js', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../../database/other-migrations/055_stationhead_daily_followers.sql', import.meta.url),
  'utf8',
);

test('Sakurazaka deployment reuses its single minute cron for daily followers', () => {
  assert.equal(config.main, 'src/sakurazaka-followers-entry.js');
  assert.deepEqual(config.triggers?.crons, ['* * * * *']);
  assert.match(entry, /isJstMidnightMinute\(scheduledAt\)/);
  assert.match(entry, /SAKURAZAKA_QUEUE\.send/);
});

test('daily follower history uses one compact row per JST date', () => {
  assert.match(migration, /observed_date_jst TEXT PRIMARY KEY/);
  assert.match(migration, /sakuramankai INTEGER NOT NULL/);
  assert.match(migration, /sakuramankai2 INTEGER NOT NULL/);
  assert.match(migration, /sakurazaka46jp INTEGER NOT NULL/);
  assert.match(migration, /nogizaka46smej INTEGER NOT NULL/);
  assert.match(migration, /WITHOUT ROWID/);
});
