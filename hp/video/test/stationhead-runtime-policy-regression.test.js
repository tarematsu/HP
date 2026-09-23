import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');
const cmake = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url), 'utf8');
const appHeader = source('app.h');
const locator = source('sh_start_button_locator_policy.h');
const reuse = source('sh_auth_capture_reuse_policy.h');
const interaction = source('sh_runtime_interaction_script.h');
const recovery = source('sh_runtime_blank_recovery_script.h');
const lifecycle = source('sh_runtime_lifecycle_script.h');
const playback = source('sh_playback_resource_policy_fix.h');

function section(text, start, end) {
  const startAt = text.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = text.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return text.slice(startAt, endAt);
}

test('mixed Stationhead runtime policy is removed from source and PCH lists', () => {
  assert.doesNotMatch(cmake, /sh_runtime_policy_fix\.h/);
  assert.match(cmake, /src\/sh_start_button_locator_policy\.h/);
  assert.match(cmake, /src\/sh_auth_capture_reuse_policy\.h/);
  assert.match(cmake, /src\/sh_runtime_interaction_script\.h/);
  assert.match(cmake, /src\/sh_runtime_blank_recovery_script\.h/);
  assert.match(cmake, /src\/sh_runtime_lifecycle_script\.h/);
});

test('native Stationhead click locator allows explicit onboarding actions through auth guard', () => {
  const body = section(
    locator,
    'inline std::wstring StationheadLocateStartButtonScriptRuntimeFixed()',
    '}  // namespace hp',
  );
  assert.match(body, /window\.top !== window/);
  assert.match(body, /allowedOnboardingPattern/);
  assert.match(body, /spotify/);
  assert.match(body, /continue/);
  assert.match(body, /let\(\?:'\|’\)\?s/);
  assert.match(body, /actionablePointForPattern\(allowedOnboardingPattern\)/);
  assert.match(body, /splitConnectSurfacePoint\(\)/);
  assert.match(body, /plainPointForPattern\(allowedOnboardingPattern\)/);
  assert.match(body, /const accountInteractionVisible = \(\) =>/);
  assert.match(body, /credentialSelector/);
  assert.match(body, /homepanelStationheadBlockingLoginVisible === true/);
  const allowedAt = body.indexOf('actionablePointForPattern(allowedOnboardingPattern)');
  const authGuardAt = body.indexOf('if (playing() || accountInteractionVisible()) return null;');
  assert.ok(allowedAt >= 0 && authGuardAt > allowedAt);
  assert.match(body, /login\|signin\|sign-in\|auth\|account\|settings/);
  assert.match(body, /spotify\|authorize\|consent/);
  assert.match(body, /document\.elementFromPoint\(x, y\)/);
  assert.match(
    locator,
    /#define StationheadLocateStartButtonScript StationheadLocateStartButtonScriptRuntimeFixed/,
  );
});

test('native Stationhead click locator resolves semantic, heading and text targets safely', () => {
  const body = section(
    locator,
    'inline std::wstring StationheadLocateStartButtonScriptRuntimeFixed()',
    '}  // namespace hp',
  );
  assert.match(body, /const candidateSelector =/);
  assert.match(body, /h1,h2,h3,\[role='heading'\],div,span,p/);
  assert.match(body, /const clickableTargetFor = element =>/);
  assert.match(body, /role === 'button'/);
  assert.match(body, /typeof current\.onclick === 'function'/);
  assert.match(body, /style\.cursor === 'pointer'/);
  assert.match(body, /const actionablePointForPattern = pattern =>/);
  assert.match(body, /const plainPointForPattern = pattern =>/);
  assert.doesNotMatch(body, /return rendered\(element\) \? element : null/);
});

test('split Connect surfaces support headings and prefer the actual action', () => {
  const body = section(
    locator,
    'inline std::wstring StationheadLocateStartButtonScriptRuntimeFixed()',
    '}  // namespace hp',
  );
  assert.match(body, /connectSurfaceLabelPattern/);
  assert.match(body, /connectSurfaceActionPattern/);
  assert.match(body, /const splitConnectSurfacePoint = \(\) =>/);
  assert.match(body, /surface\.querySelectorAll\(candidateSelector\)/);
  assert.match(body, /clickableTargetFor\(action\)/);
  assert.doesNotMatch(body, /join\s+the\s+party/i);
  assert.doesNotMatch(body, /findConnectMusicHeading/);
});

test('Start Listening and equivalent playback actions prefer clickable ancestors with fallback', () => {
  const body = section(
    locator,
    '// Playback-start actions remain blocked',
    'return script;',
  );
  assert.match(body, /document\.querySelectorAll\(candidateSelector\)/);
  assert.match(body, /matchesLabel\(element, startPattern\)/);
  assert.match(body, /clickableTargetFor\(element\)/);
  assert.match(body, /plainStartFallback/);
});

test('Connect/Reconnect Music remains auto-clickable instead of becoming login-required', () => {
  assert.doesNotMatch(interaction, /serviceConnectPattern/);
  assert.doesNotMatch(interaction, /for \(const heading of document\.querySelectorAll\("h1,h2,h3,\[role='heading'\]"\)\)/);
  assert.match(interaction, /Connect\/Reconnect Music and Connect Spotify are recoverable onboarding/);
  assert.match(locator, /\(\?:re\)\?connect/);
  assert.match(locator, /spotify/);
});

test('auth reuse policy owns only candidate reuse wrappers', () => {
  assert.match(reuse, /inline std::wstring StationheadAuthCaptureScriptRuntimeFixed\(\)/);
  assert.match(reuse, /rememberAcceptedAuthorization/);
  assert.match(reuse, /releaseRejectedAuthorization/);
  assert.match(reuse, /window\.fetch = function\(input, init\)/);
  assert.match(reuse, /NativeXhr\.prototype\.send = function/);
  assert.match(
    reuse,
    /#define StationheadAuthCaptureScript StationheadAuthCaptureScriptRuntimeFixed/,
  );
  assert.doesNotMatch(reuse, /setInterval|location\.reload|WebResourceRequested|streakStats/);
});

test('compact runtime responsibilities do not overlap', () => {
  assert.match(interaction, /accountVisible|blockingLogin|publishAudio|publishAuth/);
  assert.doesNotMatch(interaction, /location\.reload|addEventListener\('pagehide'/);

  assert.match(recovery, /sparseBlankPage|armBlankRecovery|location\.reload/);
  assert.doesNotMatch(recovery, /addEventListener|stationhead-auth-ready/);

  assert.match(lifecycle, /addEventListener\('pagehide'/);
  assert.match(lifecycle, /addEventListener\('pageshow'/);
  assert.match(lifecycle, /armBlankRecovery\(\)/);
  assert.doesNotMatch(lifecycle, /sessionStorage|blockingLogin =|accountVisible =/);

  for (const text of [interaction, recovery, lifecycle]) {
    assert.doesNotMatch(text, /setInterval\s*\(|new\s+MutationObserver|requestAnimationFrame/);
  }
});

test('authenticated stats remain owned by playback/data policy, not runtime files', () => {
  assert.match(playback, /inline std::wstring StationheadPrimaryPlayStatsScript\(int channelId\)/);
  assert.match(playback, /streakStats/);
  assert.match(playback, /response\.status === 401 \|\| response\.status === 403/);
  assert.doesNotMatch(locator + reuse + interaction + recovery + lifecycle, /streakStats/);
});

test('Stationhead state changes still shorten the central idle timer', () => {
  assert.match(appHeader, /kStationheadStateWakeMs = 2'000/);
  const markDirty = section(
    appHeader,
    'void MarkStationheadPlacementDirty() noexcept',
    'void ProcessRemoteCommands();',
  );
  assert.match(markDirty, /stationheadPlacementDirty_ = true;/);
  assert.match(markDirty, /ScheduleNextTick\(kStationheadStateWakeMs\);/);
});
