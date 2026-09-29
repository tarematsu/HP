import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function config() {
  return JSON.parse(readFileSync(new URL('../wrangler.amazon-music.jsonc', import.meta.url), 'utf8'));
}

test('Amazon Music collector keeps the daily 10:30 JST schedule', () => {
  const value = config();
  assert.equal(value.name, 'sh-amazon-music-collector');
  assert.equal(value.main, 'src/amazon-music-entry.js');
  assert.deepEqual(value.triggers.crons, ['30 1 * * *']);
  assert.deepEqual(value.d1_databases.map(({ binding }) => binding), ['MINUTE_DB']);
  assert.deepEqual(value.r2_buckets, [{
    binding: 'PAGES_RESPONSE_R2',
    bucket_name: 'sh-pages-responses',
  }]);
  assert.equal(value.queues, undefined);
});

test('Amazon Music bundle participates in Worker checks and deployment', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts['check:bundle'], /check:amazon-music-bundle/);
  assert.match(pkg.scripts['check:amazon-music-bundle'], /wrangler\.amazon-music\.jsonc/);
  assert.equal(pkg.scripts['deploy:amazon-music'], 'node scripts/deploy-amazon-music.mjs');
});
