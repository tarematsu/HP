import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = JSON.parse(readFileSync(new URL('../wrangler.sakurazaka46jp.jsonc', import.meta.url), 'utf8'));
const entry = readFileSync(new URL('../src/sakurazaka-followers-entry.js', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../../database/other-migrations/055_stationhead_daily_followers.sql', import.meta.url),
  'utf8',
);
const workflow = readFileSync(
  new URL('../../.github/workflows/stationhead-daily-followers.yml', import.meta.url),
  'utf8',
);
const collector = readFileSync(
  new URL('../../.github/scripts/collect-stationhead-daily-followers.mjs', import.meta.url),
  'utf8',
);

test('daily followers run once at JST midnight outside the Worker minute cron', () => {
  assert.equal(config.main, 'src/sakurazaka-followers-entry.js');
  assert.deepEqual(config.triggers?.crons, ['* * * * *']);
  assert.doesNotMatch(entry, /SAKURAZAKA_QUEUE\.send/);
  assert.match(entry, /stationhead_daily_followers_legacy_queue_drained/);
  assert.match(workflow, /cron: '0 15 \* \* \*'/);
  assert.match(workflow, /collect-stationhead-daily-followers\.mjs/);
  assert.match(collector, /chromium\.launch/);
  assert.match(collector, /wranglerScript/);
  assert.match(collector, /PAGES_RESPONSE_R2/);
  assert.match(collector, /OTHER_DB/);
});

test('daily follower history uses one compact row per JST date', () => {
  assert.match(migration, /observed_date_jst TEXT PRIMARY KEY/);
  assert.match(migration, /sakuramankai INTEGER NOT NULL/);
  assert.match(migration, /sakuramankai2 INTEGER NOT NULL/);
  assert.match(migration, /sakurazaka46jp INTEGER NOT NULL/);
  assert.match(migration, /nogizaka46smej INTEGER NOT NULL/);
  assert.match(migration, /WITHOUT ROWID/);
});
