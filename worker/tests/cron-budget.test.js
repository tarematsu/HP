import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function config(name) {
  return JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
}

test('active production Workers stay within the account-wide Free cron limit', () => {
  const configs = [
    config('wrangler.sakurazaka46jp.jsonc'),
    config('wrangler.buddies-collector.jsonc'),
    config('wrangler.runtime.jsonc'),
  ];
  const counts = configs.map((value) => value.triggers?.crons?.length || 0);

  assert.deepEqual(counts, [1, 1, 0]);
  assert.equal(counts.reduce((sum, count) => sum + count, 0), 2);
});

test('runtime has no cron or offline health threshold after the Actions cutover', () => {
  const runtime = config('wrangler.runtime.jsonc');
  assert.equal(runtime.triggers, undefined);
  assert.equal(Object.hasOwn(runtime.vars, 'OTHER_CRON_STALE_MS'), false);
  assert.equal(Object.hasOwn(runtime.vars, 'RUNTIME_D1_LEASE_MS'), false);
});
