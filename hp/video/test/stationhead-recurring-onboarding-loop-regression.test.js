import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const policy = source('sh_recoverable_action_policy.h');
const onboarding = source('sh_runtime_onboarding_script.h');
const compactRuntime = source('sh_compact_runtime_script.h');
const locator = source('sh_start_button_locator_policy.h');
const lifecycle = source('sh_runtime_lifecycle_script.h');
const player = source('sh.cpp');

function recoverablePattern() {
  const match = policy.match(
    /kStationheadRecoverableActionPattern\s*=\s*LR"JS\((\/\^[\s\S]*?\$\/i)\)JS";/,
  );
  assert.ok(match, 'missing shared case-insensitive recoverable-action pattern');
  const literal = match[1];
  const lastSlash = literal.lastIndexOf('/');
  assert.ok(lastSlash > 0, 'invalid recoverable-action regex literal');
  return new RegExp(literal.slice(1, lastSlash), literal.slice(lastSlash + 1));
}

test('Stationhead recovery actions are sequence-independent and case-insensitive', () => {
  const pattern = recoverablePattern();
  const accepted = [
    'CONNECT SPOTIFY',
    'connect to spotify',
    'reconnect music',
    'Reconnect Your Music',
    'continue',
    'continue with spotify',
    "LET'S GO",
    'listen here',
    'listen here instead',
    'LiStEn HeRe InStEaD',
    'listen on this device',
    'continue listening here',
    'continue listening on this device instead',
    'switch here',
    'switch to this device',
  ];
  const rejected = [
    'disconnect spotify',
    'log in',
    'sign in',
    'authorize spotify',
    'open spotify',
    'settings',
    'cancel',
  ];

  for (const label of accepted) {
    assert.equal(pattern.test(label), true, `shared policy rejected ${label}`);
  }
  for (const label of rejected) {
    assert.equal(pattern.test(label), false, `shared policy overmatched ${label}`);
  }

  // No previous-step state is required: either the full loop or a shortened
  // Connect Spotify -> Listen here instead path is just a series of independently
  // eligible current-state actions.
  for (const sequence of [
    ['CONNECT SPOTIFY', 'reconnect music', 'CONNECT SPOTIFY', 'listen here instead'],
    ['connect spotify', 'listen here instead'],
    ['reconnect music', 'listen on this device'],
    ['listen here instead'],
  ]) {
    assert.equal(sequence.every(label => pattern.test(label)), true);
  }
});

test('page detector and native locator inject the same shared action policy', () => {
  assert.match(policy, /kStationheadRecoverableActionPatternToken/);
  assert.match(policy, /InjectStationheadRecoverableActionPattern/);
  assert.match(onboarding, /recoverableOnboardingPattern = \{\{RECOVERABLE_ACTION_PATTERN\}\}/);
  assert.match(locator, /allowedOnboardingPattern = \{\{RECOVERABLE_ACTION_PATTERN\}\}/);
  assert.match(compactRuntime, /#include "sh_recoverable_action_policy\.h"/);
  assert.match(compactRuntime, /InjectStationheadRecoverableActionPattern\(script\)/);
  assert.match(locator, /#include "sh_recoverable_action_policy\.h"/);
  assert.match(locator, /InjectStationheadRecoverableActionPattern\(script\)/);
});

test('recoverable onboarding remains retriable without a sequence latch', () => {
  assert.match(onboarding, /no one-shot or sequence latch/i);
  assert.match(onboarding, /postText\('start-visible'\)/);
  assert.match(lifecycle, /publishRecoverableOnboarding\(\);/);
  assert.match(lifecycle, /progressTimer\s*=\s*nativeTimeout\(probeMediaProgress,\s*progressProbeMs\)/);
  assert.match(player, /if \(nowMs >= nextAutoClickAt_\) AttemptNativeStartClick\(nowMs\);/);
  assert.match(player, /nextAutoClickAt_\s*=\s*nowMs \+ kStationheadAutoClickRetryMs;/);
});
