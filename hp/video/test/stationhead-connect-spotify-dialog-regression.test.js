import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const onboarding = source('sh_runtime_onboarding_script.h');
const locator = source('sh_start_button_locator_policy.h');

function section(text, start, end) {
  const startAt = text.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = text.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return text.slice(startAt, endAt);
}

test('CONNECT SPOTIFY is detected across button, heading and non-semantic markup', () => {
  assert.match(onboarding, /recoverableOnboardingPattern/);
  assert.match(onboarding, /onboardingCandidateSelector/);
  assert.match(onboarding, /h1,h2,h3,\[role='heading'\],div,span,p/);
  assert.match(onboarding, /onboardingMatches\(element, recoverableOnboardingPattern\)/);
  assert.doesNotMatch(onboarding, /join\s+the\s+party/i);
});

test('CONNECT SPOTIFY is eligible before first playback and with stale audio state', () => {
  const publish = section(
    onboarding,
    'const publishRecoverableOnboarding = () => {',
    ')JS";',
  );
  assert.match(publish, /recoverableOnboardingVisible\(\)/);
  assert.match(publish, /releasePlaybackOnlyForOnboarding\(\)/);
  assert.doesNotMatch(publish, /playbackEstablished|\bplaying\(\)/);
  assert.match(publish, /postText\('start-visible'\)/);
});

test('native trusted locator prefers actionable controls then split dialog then text fallback', () => {
  assert.match(locator, /allowedOnboardingPattern/);
  assert.match(locator, /const candidateSelector =/);
  assert.match(locator, /h1,h2,h3,\[role='heading'\],div,span,p/);
  assert.match(locator, /const clickableTargetFor = element =>/);
  assert.match(locator, /typeof current\.onclick === 'function'/);
  assert.match(locator, /style\.cursor === 'pointer'/);
  const body = section(
    locator,
    '// Prefer genuine actionable controls before any text-only fallback.',
    '// Playback-start actions remain blocked',
  );
  const actionableAt = body.indexOf('actionablePointForPattern(allowedOnboardingPattern)');
  const splitAt = body.indexOf('splitConnectSurfacePoint()');
  const plainAt = body.indexOf('plainPointForPattern(allowedOnboardingPattern)');
  assert.ok(actionableAt >= 0 && splitAt > actionableAt && plainAt > splitAt);
  assert.doesNotMatch(locator, /join\s+the\s+party/i);
});
