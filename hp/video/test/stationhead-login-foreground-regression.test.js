import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const interaction = source('sh_runtime_interaction_script.h');
const lifecycle = source('sh_runtime_lifecycle_script.h');
const composition = source('sh_track_boundary_script.h');
const webview = source('sh_webview.cpp');
const audioLoss = source('sh_audio_loss.cpp');

function section(text, start, end) {
  const startAt = text.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = text.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return text.slice(startAt, endAt);
}

test('interaction owner distinguishes account state from blocking login surfaces', () => {
  assert.match(interaction, /const accountPattern =/);
  assert.match(interaction, /account\|profile\|avatar/);
  assert.match(interaction, /const accountVisible = \(\) =>/);
  assert.match(interaction, /const blockingLogin = \\(authenticated, recoverableAction = false\\) =>/);
  assert.match(interaction, /credentialSelector/);
  assert.doesNotMatch(interaction, /serviceConnectPattern/);
  assert.doesNotMatch(interaction, /querySelectorAll\("h1,h2,h3,\[role='heading'\]"\)/);
  assert.match(interaction, /const shell = element\.closest\?\.\(blockingShellSelector\)/);
  assert.match(interaction, /if \(!authenticated \|\| \(shell && visible\(shell\)\)\) return true/);
});

test('interaction publishes auth edges while lifecycle owns event scheduling', () => {
  assert.match(interaction, /postText\('login-required'\)/);
  assert.match(interaction, /post\(\{ type: 'stationhead-auth-ready', source: 'compact-runtime' \}\)/);
  assert.match(interaction, /authReadyTimer = nativeTimeout/);
  assert.match(interaction, /3000/);
  assert.match(lifecycle, /'play', 'playing', 'canplay', 'pause', 'ended', 'stalled', 'waiting', 'error'/);
  assert.match(lifecycle, /document\.addEventListener\(eventName, onStateEvent, true\)/);
  assert.doesNotMatch(interaction + lifecycle, /setInterval\s*\(|new\s+MutationObserver/);
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
