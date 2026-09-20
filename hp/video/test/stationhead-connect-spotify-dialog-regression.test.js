import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const onboarding = source('sh_runtime_onboarding_script.h');
const locator = source('sh_start_button_locator_policy.h');

test('Join the party dialog exposes CONNECT SPOTIFY even when it is not a semantic button', () => {
  assert.match(onboarding, /joinPartyHeadingPattern/);
  assert.match(onboarding, /connectSpotifyTextPattern/);
  assert.match(onboarding, /button,\[role='button'\],a,div,span,p/);
  assert.match(onboarding, /joinPartyConnectSpotifyVisible\(\)/);
  assert.match(onboarding, /if \(joinPartyConnectSpotifyVisible\(\)\) return true/);
});

test('native trusted locator clicks the nearest clickable ancestor of CONNECT SPOTIFY', () => {
  assert.match(locator, /joinPartyHeadingPattern/);
  assert.match(locator, /connectSpotifyTextPattern/);
  assert.match(locator, /const clickableTargetFor = element =>/);
  assert.match(locator, /style\.cursor === 'pointer'/);
  assert.match(locator, /const joinPartyConnectSpotifyPoint = \(\) =>/);
  assert.match(locator, /clickableTargetFor\(candidate\)/);
  assert.match(locator, /const joinPartyPoint = joinPartyConnectSpotifyPoint\(\)/);
  assert.match(locator, /if \(joinPartyPoint\) return joinPartyPoint/);
});
