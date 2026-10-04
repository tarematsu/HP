import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cloud = JSON.parse(readFileSync(
  new URL('../hp/cloud/wrangler.jsonc', import.meta.url),
  'utf8',
));
const dispatcher = JSON.parse(readFileSync(
  new URL('../worker/wrangler.cron-dispatcher.jsonc', import.meta.url),
  'utf8',
));

test('generic Cron dispatcher persists invocations for CPU coverage', () => {
  assert.deepEqual(cloud.triggers, { crons: [] });
  assert.deepEqual(dispatcher.triggers?.crons, ['* * * * *']);
  assert.equal(dispatcher.observability?.enabled, true);
  assert.equal(dispatcher.observability?.logs?.enabled, true);
  assert.equal(dispatcher.observability?.logs?.persist, true);
  assert.equal(dispatcher.observability?.logs?.invocation_logs, true);
});
