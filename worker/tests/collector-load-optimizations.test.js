import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('inline collection records materialization state after structural changes', () => {
  const runner = source('../src/prepared-collector-runner.js');
  assert.match(runner, /import \{ recordQueueMaterialization \}/);
  assert.match(runner, /queueResult\?\.structure_changed === true/);
  assert.match(runner, /recordQueueMaterialization\(/);
  assert.match(runner, /materialization_state_written/);
});

test('snapshot analysis is computed only in persistence slots', () => {
  const collector = source('../src/raw-collector-entry.js');
  assert.match(collector, /function snapshotAnalysisDue/);
  assert.match(collector, /snapshotAnalysisDue\(env, base\.observed_at\)/);
  assert.match(collector, /payload_bytes/);
});

test('collector and recovery use sampled invocation and application logs', () => {
  for (const path of [
    '../wrangler.buddies-collector.jsonc',
    '../wrangler.buddies-recovery.jsonc',
  ]) {
    const config = JSON.parse(source(path));
    assert.equal(config.observability.head_sampling_rate, 0.1, path);
    assert.equal(config.observability.logs.head_sampling_rate, 0.1, path);
    assert.equal(config.observability.logs.invocation_logs, true, path);
  }
});
