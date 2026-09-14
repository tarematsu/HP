import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const startup = source('sh_startup_script.h');
const composition = source('sh_track_boundary_script.h');
const lifecycle = source('sh_runtime_lifecycle_policy_fix.h');
const webview = source('sh_webview.cpp');
const audioLoss = source('sh_audio_loss.cpp');

function section(text, start, end) {
  const startAt = text.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = text.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return text.slice(startAt, endAt);
}

const compact = section(
  startup,
  'inline std::wstring StationheadCompactRuntimeScript(',
  'inline std::wstring BuildStationheadStartupScript(',
);

test('compact runtime distinguishes account state from blocking login surfaces', () => {
  assert.match(compact, /const accountPattern =/);
  assert.match(compact, /account\|profile\|avatar/);
  assert.match(compact, /const accountVisible = \(\) =>/);
  assert.match(compact, /const blockingLogin = authenticated =>/);
  assert.match(compact, /credentialSelector/);
  assert.match(compact, /serviceConnectPattern\.test\(labelOf\(heading\)\)/);
  assert.match(compact, /const shell = element\.closest\?\.\(blockingShellSelector\)/);
  assert.match(compact, /if \(!authenticated \|\| \(shell && visible\(shell\)\)\) return true/);
});

test('compact runtime publishes login and auth-ready edges without a recurring poll', () => {
  assert.match(compact, /postText\('login-required'\)/);
  assert.match(compact, /post\(\{ type: 'stationhead-auth-ready', source: 'compact-runtime' \}\)/);
  assert.match(compact, /authReadyTimer = nativeTimeout/);
  assert.match(compact, /3000/);
  assert.match(compact, /'play', 'playing', 'canplay', 'pause', 'ended', 'stalled', 'waiting', 'error'/);
  assert.match(compact, /document\.addEventListener\(eventName, onStateEvent, true\)/);
  assert.doesNotMatch(compact, /setInterval\s*\(/);
  assert.doesNotMatch(compact, /new\s+MutationObserver/);
  assert.doesNotMatch(lifecycle, /setInterval|setTimeout|MutationObserver/);
});

test('legacy login and track-boundary registration slots are inert', () => {
  assert.match(composition, /StationheadLoginSettlementScript[\s\S]*return L"void 0;"/);
  assert.match(composition, /StationheadTrackBoundaryScript[\s\S]*return L"void 0;"/);
  assert.doesNotMatch(composition, /StationheadAutoplayScriptForegroundLogin/);
});

test('native login-required message always surfaces Stationhead', () => {
  const handler = section(
    webview,
    'if (message == prefix + L"-login-required") {',
    'LPWSTR messageRaw = nullptr;',
  );
  assert.match(handler, /loginRequired_ = true;/);
  assert.match(handler, /ShowForLogin\(\);/);
  assert.doesNotMatch(handler, /AudioPlaying\(|audioPlaying_|playing\)/);
});

test('audible playback cannot clear a confirmed login-required surface', () => {
  const branch = section(
    audioLoss,
    'const bool audioPlaying = AudioPlaying();',
    'const bool authenticationPending =',
  );
  assert.match(branch, /!spotifyAuthorization_ && !loginRequired_/);
  assert.match(branch, /SelectTab\(StationheadTabKind::None\);/);
  assert.doesNotMatch(branch, /loginRequired_ = false|status_\.loginRequired = false/);
});
