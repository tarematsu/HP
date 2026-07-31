import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const updateCheck = readFileSync(
  new URL('../hp/cloud/src/update_check.ts', import.meta.url),
  'utf8',
);
const schedulerRuntime = readFileSync(
  new URL('../hp/cloud/src/scheduler_runtime.ts', import.meta.url),
  'utf8',
);
const workerCore = readFileSync(
  new URL('../hp/cloud/src/worker_core.ts', import.meta.url),
  'utf8',
);

test('update ping moves manifest and D1 work to the Scheduler Durable Object', () => {
  const queueFunction = updateCheck.match(
    /export function queueUpdateCheckPing\([\s\S]*?\n}\n\nexport function runUpdateCheck/,
  )?.[0] || '';

  assert.match(workerCore, /queueUpdateCheckPing\(env, ctx\)/);
  assert.match(queueFunction, /SCHEDULER_COORDINATOR/);
  assert.match(queueFunction, /ctx\.waitUntil\(signalUpdateCheck\(env\)/);
  assert.doesNotMatch(queueFunction, /coalescedUpdateCheck|performUpdateCheck|readUpdateManifestIdentity|readState/);
  assert.match(updateCheck, /https:\/\/scheduler\.internal\/wake/);
  assert.match(updateCheck, /body: '\{"names":\["update_check"\]\}'/);
  assert.match(schedulerRuntime, /job\.name === "update_check"\) await runUpdateCheck\(env\)/);
});

test('update ping retains bounded cooldown and failure recovery', () => {
  assert.match(updateCheck, /UPDATE_PING_COOLDOWN_MS = 60_000/);
  assert.match(updateCheck, /now - lastUpdatePingAt < UPDATE_PING_COOLDOWN_MS/);
  assert.match(updateCheck, /lastUpdatePingAt = 0;[\s\S]*update ping failed/);
  assert.match(updateCheck, /await response\.body\?\.cancel\(\)/);
});
