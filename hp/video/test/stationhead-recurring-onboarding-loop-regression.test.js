import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const onboarding = source('sh_runtime_onboarding_script.h');
const locator = source('sh_start_button_locator_policy.h');
const lifecycle = source('sh_runtime_lifecycle_script.h');
const player = source('sh.cpp');

function patternAfter(text, marker) {
  const at = text.indexOf(marker);
  assert.notEqual(at, -1, `missing marker: ${marker}`);
  const match = text.slice(at).match(/\/\^([\s\S]*?)\$\/i;/);
  assert.ok(match, `missing case-insensitive anchored regex after: ${marker}`);
  return new RegExp(`^${match[1]}$`, 'i');
}

test('recurring Stationhead music onboarding sequence is fully allowlisted case-insensitively', () => {
  const runtimePattern = patternAfter(onboarding, 'const recoverableOnboardingPattern =');
  const locatorPattern = patternAfter(locator, 'const allowedOnboardingPattern =');
  const labels = [
    'CONNECT SPOTIFY',
    'reconnect music',
    'Connect Spotify',
    'listen here instead',
    'LiStEn HeRe InStEaD',
  ];

  for (const label of labels) {
    assert.equal(runtimePattern.test(label), true, `runtime rejected ${label}`);
    assert.equal(locatorPattern.test(label), true, `locator rejected ${label}`);
  }
});

test('recoverable onboarding remains retriable when Stationhead cycles the same flow again', () => {
  assert.match(onboarding, /no\s+one-shot\s+latch/i);
  assert.match(onboarding, /postText\('start-visible'\)/);
  assert.match(lifecycle, /publishRecoverableOnboarding\(\);/);
  assert.match(lifecycle, /progressTimer\s*=\s*nativeTimeout\(probeMediaProgress,\s*progressProbeMs\)/);
  assert.match(player, /if \(nowMs >= nextAutoClickAt_\) AttemptNativeStartClick\(nowMs\);/);
  assert.match(player, /nextAutoClickAt_\s*=\s*nowMs \+ kStationheadAutoClickRetryMs;/);
});
