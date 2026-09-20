import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const interaction = source('sh_runtime_interaction_script.h');
const onboarding = source('sh_runtime_onboarding_script.h');
const lifecycle = source('sh_runtime_lifecycle_script.h');
const compact = source('sh_compact_runtime_script.h');
const clickPolicy = source('sh_onboarding_click_policy.h');
const startup = source('sh_startup_script.h');
const locator = source('sh_start_button_locator_policy.h');

function section(text, start, end) {
  const startAt = text.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = text.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return text.slice(startAt, endAt);
}

test('recoverable Stationhead onboarding clears stale login state and signals native click', () => {
  assert.match(onboarding, /const recoverableOnboardingPattern =/);
  assert.match(onboarding, /\(\?:re\)\?connect/);
  assert.match(onboarding, /spotify/);
  assert.match(onboarding, /continue/);
  assert.match(onboarding, /let\(\?:'\|’\)\?s/);
  assert.match(onboarding, /const recoverableOnboardingVisible = \(\) =>/);

  const publish = section(
    onboarding,
    'const publishRecoverableOnboarding = () => {',
    ')JS";',
  );
  const blockingAt = publish.indexOf('blockingLogin(authenticated)');
  const readyAt = publish.indexOf("type: 'stationhead-auth-ready'");
  const clickAt = publish.indexOf("postText('start-visible')");
  assert.ok(blockingAt >= 0 && readyAt > blockingAt && clickAt > readyAt);
  assert.match(publish, /window\.__homepanelStationheadBlockingLoginVisible = false/);
  assert.match(publish, /source: 'recoverable-onboarding'/);
  assert.match(interaction, /if \(publishRecoverableOnboarding\(\)\) return;/);
});

test('recoverable onboarding is armed only after established playback is lost', () => {
  assert.match(interaction, /let playbackEstablished = false;/);
  assert.match(interaction, /if \(current\) playbackEstablished = true;/);

  const publish = section(
    onboarding,
    'const publishRecoverableOnboarding = () => {',
    ')JS";',
  );
  assert.match(
    publish,
    /!pageActive \|\| !document\.body \|\| !playbackEstablished \|\| playing\(\)/,
  );
  assert.match(publish, /const authenticated = accountVisible\(\);/);
});

test('recoverable onboarding does not depend on semantic button or heading markup', () => {
  assert.match(onboarding, /const onboardingCandidateSelector =/);
  assert.match(onboarding, /div,span,p/);
  assert.match(onboarding, /connectSurfaceLabelPattern/);
  assert.match(onboarding, /connectSurfaceActionPattern/);
  assert.match(onboarding, /splitConnectSurfaceVisible/);
  assert.doesNotMatch(onboarding, /joinPartyHeadingPattern|headingSelector|role=.?heading/);

  assert.match(locator, /const candidateSelector = semanticSelector \+ ',div,span,p'/);
  assert.match(locator, /const clickableTargetFor = element =>/);
  assert.match(locator, /style\.cursor === 'pointer'/);
  assert.match(locator, /const pointForPattern = pattern =>/);
  assert.match(locator, /const splitConnectSurfacePoint = \(\) =>/);
  assert.doesNotMatch(locator, /joinPartyHeadingPattern/);
});

test('all allowlisted onboarding actions use the same non-semantic click resolver', () => {
  const onboardingSection = section(
    locator,
    '// All allowlisted onboarding actions share one resolution path.',
    '// Playback-start actions remain blocked',
  );
  assert.match(onboardingSection, /pointForPattern\(allowedOnboardingPattern\)/);
  assert.match(onboardingSection, /splitConnectSurfacePoint\(\)/);
  assert.match(locator, /clickableTargetFor\(element\)/);
});

test('playback start actions also resolve non-semantic targets through clickable ancestors', () => {
  const playback = section(
    locator,
    '// Playback-start actions remain blocked',
    'return script;',
  );
  assert.match(playback, /document\.querySelectorAll\(candidateSelector\)/);
  assert.match(playback, /matchesLabel\(element, startPattern\)/);
  assert.match(playback, /clickableTargetFor\(element\)/);
});

test('compact runtime composes onboarding before lifecycle execution', () => {
  const onboardingAt = compact.indexOf('StationheadRuntimeOnboardingFragment()');
  const lifecycleAt = compact.indexOf('StationheadRuntimeLifecycleFragment()');
  assert.ok(onboardingAt >= 0 && lifecycleAt > onboardingAt);
  assert.match(compact, /script\.append\(onboarding\)/);
});

test('existing four-second media probe retries recoverable onboarding without a new high-rate poller', () => {
  const probe = section(
    lifecycle,
    'const probeMediaProgress = () => {',
    'for (const eventName of [',
  );
  assert.match(probe, /publishRecoverableOnboarding\(\);/);
  assert.match(lifecycle, /const progressProbeMs = 4000;/);
  assert.doesNotMatch(interaction + onboarding + lifecycle, /setInterval\s*\(|new\s+MutationObserver/);
});

test('start-visible bypasses playback and login latches through trusted native locator', () => {
  assert.match(startup, /#include "sh_onboarding_click_policy\.h"/);
  assert.match(clickPolicy, /TrustedStationheadMessage/);
  assert.match(clickPolicy, /StartVisibleMessage/);
  assert.match(clickPolicy, /message\.ends_with\(L"-start-visible"\)/);
  assert.match(clickPolicy, /StationheadLocateStartButtonScript\(\)/);
  assert.match(clickPolicy, /ParseStationheadLocateButtonResult/);
  assert.match(clickPolicy, /Input\.dispatchMouseEvent/);
  assert.match(clickPolicy, /AttemptTrustedOnboardingClick\(sender\)/);
  assert.doesNotMatch(clickPolicy, /audioPlaying_|loginRequired_|AttemptNativeStartClick\s*\(/);
});

test('untrusted web messages never reach the onboarding click dispatcher', () => {
  const wrapper = section(
    clickPolicy,
    'WrapStationheadOnboardingWebMessageHandler(',
    '}  // namespace hp::stationhead_onboarding_click_policy',
  );
  const trustedAt = wrapper.indexOf('TrustedStationheadMessage(sender, args)');
  const clickAt = wrapper.indexOf('AttemptTrustedOnboardingClick(sender)');
  assert.ok(trustedAt >= 0 && clickAt > trustedAt);
  assert.match(clickPolicy, /SameTrustedMessageOrigin/);
});
