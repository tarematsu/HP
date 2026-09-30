import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function config() {
  return JSON.parse(readFileSync(new URL('../wrangler.amazon-music.jsonc', import.meta.url), 'utf8'));
}

test('music collector keeps hourly Amazon update detection and gated 10-minute deep scans', () => {
  const value = config();
  assert.equal(value.name, 'sh-amazon-music-collector');
  assert.equal(value.main, 'src/amazon-music-entry.js');
  assert.deepEqual(value.triggers.crons, [
    '15 * * * *',
    '5 * * * *',
    '2,12,22,32,42,52 * * * *',
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

test('scheduled entry separates canonical identity from service storage', () => {
  const source = readFileSync(new URL('../src/amazon-music-entry.js', import.meta.url), 'utf8');
  assert.match(source, /APPLE_MUSIC_PROBE_CRON = '15 \* \* \* \*'/);
  assert.match(source, /AMAZON_MUSIC_TOP_SCAN_CRON = '5 \* \* \* \*'/);
  assert.match(source, /AMAZON_MUSIC_DEEP_SCAN_CRON = '2,12,22,32,42,52 \* \* \* \*'/);
  assert.match(source, /amazonMusicServiceEnv\(env\)/);
  assert.match(source, /persistAppleMusicModelToOther\(env, scheduledTime\)/);
  assert.match(source, /persistAmazonMusicModelToOther\(env, scheduledTime\)/);
  assert.match(source, /cron === AMAZON_MUSIC_TOP_SCAN_CRON[\s\S]*checkAmazonMusic/);
  assert.match(source, /cron === AMAZON_MUSIC_DEEP_SCAN_CRON[\s\S]*continueAmazonMusic/);
  assert.doesNotMatch(source, /AMAZON_MUSIC_DAILY_CRON|collectAmazonMusicSnapshot/);
});

test('Amazon Music bundle participates in Worker checks and deployment', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts['check:bundle'], /check:amazon-music-bundle/);
  assert.match(pkg.scripts['check:amazon-music-bundle'], /wrangler\.amazon-music\.jsonc/);
  assert.equal(pkg.scripts['deploy:amazon-music'], 'node scripts/deploy-amazon-music.mjs');
});
