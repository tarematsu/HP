import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function config(name) {
  return JSON.parse(readFileSync(new URL(`../wrangler.${name}.jsonc`, import.meta.url), 'utf8'));
}

function assertCompleteInvocationCoverage(worker) {
  assert.equal(worker.observability.enabled, true);
  assert.equal(worker.observability.head_sampling_rate, 1);
  assert.equal(worker.observability.logs.enabled, true);
  assert.equal(worker.observability.logs.persist, true);
  assert.equal(worker.observability.logs.invocation_logs, true);
  assert.equal(worker.observability.logs.head_sampling_rate, 1);
}

test('low-traffic Workers persist every invocation for deterministic CPU coverage', () => {
  assertCompleteInvocationCoverage(config('sakurazaka46jp'));
  assertCompleteInvocationCoverage(config('runtime'));
});
