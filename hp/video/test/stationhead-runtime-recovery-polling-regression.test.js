import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');
const cmake = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url), 'utf8');
const recovery = source('sh_runtime_blank_recovery_script.h');
const lifecycle = source('sh_runtime_lifecycle_script.h');
const compact = source('sh_compact_runtime_script.h');

test('legacy recovery polling header is removed from the build', () => {
  assert.doesNotMatch(cmake, /sh_runtime_recovery_polling_policy_fix\.h/);
  assert.match(cmake, /sh_runtime_blank_recovery_script\.h/);
});

test('blank recovery owns only bounded one-shot checks', () => {
  assert.match(recovery, /const armBlankRecovery = \(\) =>/);
  assert.match(recovery, /blankTimer = nativeTimeout[\s\S]*30000/);
  assert.match(recovery, /blankConfirmTimer = nativeTimeout[\s\S]*15000/);
  assert.match(recovery, /now - lastReload < 120000/);
  assert.match(recovery, /location\.reload\(\)/);
  assert.doesNotMatch(recovery, /setInterval\s*\(|MutationObserver|addEventListener/);
});

test('lifecycle owns recovery arming and teardown', () => {
  assert.match(lifecycle, /armBlankRecovery\(\)/);
  assert.match(lifecycle, /pagehide/);
  assert.match(lifecycle, /blankTimer, blankConfirmTimer/);
  assert.doesNotMatch(lifecycle, /location\.reload\(\)|sessionStorage/);
});

test('compact runtime composes recovery exactly once', () => {
  assert.equal((compact.match(/StationheadRuntimeBlankRecoveryFragment\(\)/g) ?? []).length, 1);
});
