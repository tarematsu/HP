import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const composition = readFileSync(
  new URL('../../native/src/sh_track_boundary_script.h', import.meta.url),
  'utf8',
);
const webview = readFileSync(
  new URL('../../native/src/sh_webview.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('responsive-hidden Log in is reported after document commit without playback or viewport gating', () => {
  const probe = section(
    composition,
    'inline std::wstring StationheadAutoplayScriptForegroundLogin(',
    '// Media boundaries never initiate navigation.',
  );

  assert.match(probe, /loginPattern = \/\^\(log\\s\*in\|sign\\s\*in\|login\)/);
  assert.match(probe, /\^\\\/\(sign-in\|login\)/);
  assert.match(probe, /DOMContentLoaded', activate/);
  assert.match(probe, /\}, 500\);/);
  assert.match(probe, /postMessage\(prefix \+ '-login-required'\)/);
  assert.doesNotMatch(probe, /__homepanelAudioPlaying|mediaSession|audioPlaying|isPlaying/);
  assert.doesNotMatch(probe, /getBoundingClientRect|getComputedStyle|style\.display|style\.visibility/);
  assert.doesNotMatch(probe, /15000|15 \* 1000/);
  assert.match(
    composition,
    /#undef StationheadAutoplayScript\s+#define StationheadAutoplayScript StationheadAutoplayScriptForegroundLogin/,
  );
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
