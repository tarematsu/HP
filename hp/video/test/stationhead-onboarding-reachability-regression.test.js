import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const interaction = source('sh_runtime_interaction_script.h');
const recoverablePolicy = source('sh_recoverable_action_policy.h');
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
  assert.match(onboarding, /const recoverableOnboardingPattern = \{\{RECOVERABLE_ACTION_PATTERN\}\}/);
  assert.match(recoverablePolicy, /\(\?:re\)\?connect/);
  assert.match(recoverablePolicy, /spotify/);
  assert.match(recoverablePolicy, /continue/);
  assert.match(recoverablePolicy, /let\(\?:'\|’\)\?s/);
  assert.match(onboarding, /const recoverableOnboardingVisible = \(\) =>/);

  const publish = section(
    onboarding,
    'const publishRecoverableOnboarding = () => {',
    ')JS";',
  );
  const blockingAt = publish.indexOf('blockingLogin(true, true)');
  const readyAt = publish.indexOf("type: 'stationhead-auth-ready'");
  const clickAt = publish.indexOf("postText('start-visible')");
  assert.ok(blockingAt >= 0 && readyAt > blockingAt && clickAt > readyAt);
  assert.match(publish, /window\.__homepanelStationheadBlockingLoginVisible = false/);
  assert.match(publish, /source: 'recoverable-onboarding'/);
  assert.match(interaction, /if \(publishRecoverableOnboarding\(\)\) return;/);
});

test('allowlisted onboarding is signaled before first playback and despite stale playing state', () => {
  const publish = section(
    onboarding,
    'const publishRecoverableOnboarding = () => {',
    ')JS";',
  );
  assert.match(publish, /if \(!pageActive \|\| !document\.body\) return false;/);
  assert.match(publish, /releasePlaybackOnlyForOnboarding\(\);/);
  assert.doesNotMatch(publish, /!playbackEstablished|\bplaying\(\)/);
  assert.doesNotMatch(publish, /const authenticated = accountVisible\(\);/);
  assert.match(publish, /if \\(blockingLogin\\(true, true\\)\\) return false;/);
});

test('stale playback-only rendering is released from exact onboarding labels before geometry checks', () => {
  assert.match(onboarding, /const playbackOnlyAttribute = 'data-homepanel-stationhead-playback-only'/);
  const release = section(
    onboarding,
    'const releasePlaybackOnlyForOnboarding = () => {',
    'const keepStreamingVisible = () => {',
  );
  assert.match(release, /hasAttribute\?\.\(playbackOnlyAttribute\)/);
  assert.match(release, /onboardingLabelMatches\(element, keepStreamingPattern\)/);
  assert.match(release, /onboardingLabelMatches\(element, recoverableOnboardingPattern\)/);
  assert.match(release, /onboardingLabelMatches\(element, connectSurfaceLabelPattern\)/);
  assert.match(release, /removeAttribute\(playbackOnlyAttribute\)/);
  assert.doesNotMatch(release, /getBoundingClientRect|getComputedStyle/);
});

test('recoverable onboarding covers semantic, heading and non-semantic Stationhead markup', () => {
  assert.match(onboarding, /const onboardingCandidateSelector =/);
  assert.match(onboarding, /h1,h2,h3,\[role='heading'\],div,span,p/);
  assert.match(onboarding, /connectSurfaceLabelPattern/);
  assert.match(onboarding, /connectSurfaceActionPattern/);
  assert.match(onboarding, /splitConnectSurfaceVisible/);
  assert.doesNotMatch(onboarding, /joinPartyHeadingPattern/);

  assert.match(locator, /const candidateSelector =/);
  assert.match(locator, /h1,h2,h3,\[role='heading'\],div,span,p/);
  assert.match(locator, /const clickableTargetFor = element =>/);
  assert.match(locator, /style\.cursor === 'pointer'/);
  assert.match(locator, /const actionablePointForPattern = pattern =>/);
  assert.match(locator, /const plainPointForPattern = pattern =>/);
  assert.match(locator, /const splitConnectSurfacePoint = \(\) =>/);
  assert.doesNotMatch(locator, /joinPartyHeadingPattern/);
});

test('split Reconnect Music surface is resolved before plain text fallback', () => {
  const onboardingSection = section(
    locator,
    '// Every recoverable music-service action is current-state driven and',
    '// Playback-start actions remain blocked',
  );
  const actionableAt = onboardingSection.indexOf(
    'actionablePointForPattern(allowedOnboardingPattern)',
  );
  const splitAt = onboardingSection.indexOf('splitConnectSurfacePoint()');
  const plainAt = onboardingSection.indexOf(
    'plainPointForPattern(allowedOnboardingPattern)',
  );
  assert.ok(actionableAt >= 0 && splitAt > actionableAt && plainAt > splitAt);
  assert.match(locator, /const clickableTargetFor = element =>/);
  assert.match(locator, /return null;/);
});

test('playback start actions prefer clickable ancestors but retain a non-semantic fallback', () => {
  const playback = section(
    locator,
    '// Playback-start actions remain blocked',
    'return script;',
  );
  assert.match(playback, /document\.querySelectorAll\(candidateSelector\)/);
  assert.match(playback, /matchesLabel\(element, startPattern\)/);
  assert.match(playback, /clickableTargetFor\(element\)/);
  assert.match(playback, /plainStartFallback/);
});

test('compact runtime composes onboarding before lifecycle execution', () => {
  const onboardingAt = compact.indexOf('StationheadRuntimeOnboardingFragment()');
  const lifecycleAt = compact.indexOf('StationheadRuntimeLifecycleFragment()');
  assert.ok(onboardingAt >= 0 && lifecycleAt > onboardingAt);
  assert.match(compact, /script\.append\(onboarding\)/);
});

test('existing four-second media probe retries allowlisted onboarding without a new high-rate poller', () => {
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
