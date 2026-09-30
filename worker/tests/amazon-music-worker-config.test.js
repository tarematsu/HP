import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function config() {
  return JSON.parse(readFileSync(new URL('../wrangler.amazon-music.jsonc', import.meta.url), 'utf8'));
}

test('music collector keeps daily Amazon collection, hourly update detection, and 10-minute deep scans', () => {
  const value = config();
  assert.equal(value.name, 'sh-amazon-music-collector');
  assert.equal(value.main, 'src/amazon-music-entry.js');
  assert.deepEqual(value.triggers.crons, [
    '15 * * * *',
    '5 * * * *',
    '2,12,22,32,42,52 * * * *',
    '30 1 * * *',
  ]);
  assert.deepEqual(value.d1_databases.map(({ binding }) => binding), ['MINUTE_DB']);
  assert.deepEqual(value.r2_buckets, [{
    binding: 'PAGES_RESPONSE_R2',
    bucket_name: 'sh-pages-responses',
  }]);
  assert.equal(value.queues, undefined);
});

test('scheduled entry separates global top-1000 detection from Sakamichi 100k storage', () => {
  const source = readFileSync(new URL('../src/amazon-music-entry.js', import.meta.url), 'utf8');
  assert.match(source, /APPLE_MUSIC_PROBE_CRON = '15 \* \* \* \*'/);
  assert.match(source, /AMAZON_MUSIC_TOP_SCAN_CRON = '5 \* \* \* \*'/);
  assert.match(source, /AMAZON_MUSIC_DEEP_SCAN_CRON = '2,12,22,32,42,52 \* \* \* \*'/);
  assert.match(source, /AMAZON_MUSIC_DAILY_CRON = '30 1 \* \* \*'/);
  assert.match(source, /cron === AMAZON_MUSIC_TOP_SCAN_CRON[\s\S]*monitorAmazonTop1000/);
  assert.match(source, /cron === AMAZON_MUSIC_DEEP_SCAN_CRON[\s\S]*continueAmazon100kScan/);
  assert.match(source, /cron === AMAZON_MUSIC_DAILY_CRON[\s\S]*collectAmazonMusicSnapshot/);
});

test('Amazon Music bundle participates in Worker checks and deployment', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts['check:bundle'], /check:amazon-music-bundle/);
  assert.match(pkg.scripts['check:amazon-music-bundle'], /wrangler\.amazon-music\.jsonc/);
  assert.equal(pkg.scripts['deploy:amazon-music'], 'node scripts/deploy-amazon-music.mjs');
});
