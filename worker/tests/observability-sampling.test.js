import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function config(name) {
  return JSON.parse(readFileSync(new URL(`../wrangler.${name}.jsonc`, import.meta.url), 'utf8'));
}

test('low-traffic Sakurazaka worker persists every invocation for deterministic coverage', () => {
  const sakurazaka = config('sakurazaka46jp');
  assert.equal(sakurazaka.observability.enabled, true);
  assert.equal(sakurazaka.observability.head_sampling_rate, 1);
  assert.equal(sakurazaka.observability.logs.enabled, true);
  assert.equal(sakurazaka.observability.logs.persist, true);
  assert.equal(sakurazaka.observability.logs.invocation_logs, true);
  assert.equal(sakurazaka.observability.logs.head_sampling_rate, 1);
});
