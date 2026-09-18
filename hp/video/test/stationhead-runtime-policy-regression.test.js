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

test('native Stationhead click locator allows explicit music connect/reconnect actions through auth guard', () => {
  const body = section(
    locator,
    'inline std::wstring StationheadLocateStartButtonScriptRuntimeFixed()',
    '}  // namespace hp',
  );
  assert.match(body, /window\.top !== window/);
  assert.match(body, /allowedOnboardingPattern/);
  assert.match(
    body,
    /\(\?:re\)\?connect\(\?:\\s\+with\)\?\\s\+\(\?:spotify\|music\)\|continue/,
  );
  assert.ok(body.includes("const allowedOnboardingPattern = /^(?:(?:re)?connect(?:\\s+with)?\\s+(?:spotify|music)|continue)$/i;"));
  assert.match(body, /labelsOf\(element\)\.some\(label => allowedOnboardingPattern\.test\(label\)\)/);
  assert.match(body, /const accountInteractionVisible = \(\) =>/);
  assert.match(body, /credentialSelector/);
  assert.match(body, /homepanelStationheadBlockingLoginVisible === true/);
  const allowedAt = body.indexOf('allowedOnboardingPattern.test(label)');
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

test('native Stationhead click locator resolves split Connect music modal actions', () => {
  const body = section(
    locator,
    'inline std::wstring StationheadLocateStartButtonScriptRuntimeFixed()',
    '}  // namespace hp',
  );
  assert.ok(body.includes("const connectMusicHeadingPattern = /^(?:re)?connect\\s+music$/i;"));
  assert.ok(body.includes("const connectMusicActionPattern = /^(?:connect|reconnect)$/i;"));
  assert.match(body, /const findConnectMusicHeading = \(\) =>/);
  assert.match(body, /const findConnectMusicText = \(\) =>/);
  assert.match(body, /document\.querySelectorAll\('\*'\)/);
  assert.match(body, /\[role='dialog'\],\[aria-modal='true'\]/);
  assert.match(body, /const connectMusicModalAction = \(\) =>/);
  assert.match(body, /shell && shell !== document\.body && depth < 10/);
  assert.match(
    body,
    /labelsOf\(action\)\.some\(label => connectMusicActionPattern\.test\(label\))/,
  );
  assert.match(body, /const modalConnectPoint = connectMusicModalAction\(\);/);
  const modalAt = body.indexOf('const modalConnectPoint = connectMusicModalAction();');
  const allowedAt = body.indexOf('allowedOnboardingPattern.test(label)');
  const authGuardAt = body.indexOf('if (playing() || accountInteractionVisible()) return null;');
  assert.ok(modalAt >= 0 && allowedAt > modalAt && authGuardAt > allowedAt);
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
