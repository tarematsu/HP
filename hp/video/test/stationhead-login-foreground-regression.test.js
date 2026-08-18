import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shared = readFileSync(
  new URL('../../native/src/sh_shared.h', import.meta.url),
  'utf8',
);
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

test('active Stationhead observer reports Log in before playback viewport gating', () => {
  const autoplay = section(
    shared,
    'inline std::wstring StationheadAutoplayScript(',
    'inline std::wstring StationheadVolumeScript(',
  );

  assert.match(autoplay, /loginPattern = \/\^\(log\\s\*in\|sign\\s\*in\|login\)/);
  const loopAt = autoplay.indexOf('for (const element of document.querySelectorAll(selector))');
  const loginAt = autoplay.indexOf('if (!login && loginPattern.test(label)) login = true;', loopAt);
  const visibleAt = autoplay.indexOf('if (!visible(element))', loopAt);
  assert.notEqual(loopAt, -1);
  assert.notEqual(loginAt, -1);
  assert.notEqual(visibleAt, -1);
  assert.ok(loginAt < visibleAt, 'login detection must precede CSS/viewport visibility gating');

  assert.match(autoplay, /if \(!loginReported\) \{[\s\S]*postMessage\('\{\{PREFIX\}\}-login-required'\)/);
  assert.doesNotMatch(autoplay, /observedAt|15000|nativeTimeout\(schedule, 15000\)/);
  assert.match(autoplay, /if \(!start && !isPlaying && startPattern\.test\(label\)\) start = element;/);
  assert.doesNotMatch(
    composition,
    /StationheadAutoplayScriptForegroundLogin|#define StationheadAutoplayScript/,
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
