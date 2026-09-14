import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_runtime_recovery_polling_policy_fix.h', import.meta.url),
  'utf8',
);
const startup = readFileSync(
  new URL('../../native/src/sh_startup_script.h', import.meta.url),
  'utf8',
);

test('legacy recovery polling policy is retired', () => {
  assert.match(policy, /Retired compatibility header/);
  assert.doesNotMatch(policy, /setInterval|setTimeout|MutationObserver|location\.reload/);
  assert.doesNotMatch(policy, /StationheadAutoplayScriptRecoveryPollingFixed/);
});

test('compact runtime owns bounded blank-page recovery', () => {
  assert.match(startup, /const armBlankRecovery = \(\) =>/);
  assert.match(startup, /blankTimer = nativeTimeout[\s\S]*30000/);
  assert.match(startup, /blankConfirmTimer = nativeTimeout[\s\S]*15000/);
  assert.match(startup, /now - lastReload < 120000/);
  assert.match(startup, /location\.reload\(\)/);
  assert.doesNotMatch(startup, /setInterval\s*\(/);
});
