import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cloud = JSON.parse(readFileSync(
  new URL('../hp/cloud/wrangler.jsonc', import.meta.url),
  'utf8',
));

test('hourly video Cron persists every integrated Worker invocation for CPU coverage', () => {
  assert.deepEqual(cloud.triggers?.crons, ['0 * * * *']);
  assert.equal(cloud.observability?.enabled, true);
  assert.equal(cloud.observability?.logs?.enabled, true);
  assert.equal(cloud.observability?.logs?.persist, true);
  assert.equal(cloud.observability?.logs?.invocation_logs, true);
});
