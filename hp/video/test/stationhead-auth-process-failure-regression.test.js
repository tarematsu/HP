import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const memoryPolicy = readFileSync(
  new URL('../../native/src/sh_auth_interactive_memory_policy_fix.h', import.meta.url),
  'utf8',
);
const processPolicy = readFileSync(
  new URL('../../native/src/sh_auth_process_failure_policy_fix.h', import.meta.url),
  'utf8',
);
const webviewSource = readFileSync(
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

test('auth process-failure policy is compiled after interactive memory policy', () => {
  const memoryMacroAt = memoryPolicy.indexOf(
    '#define COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW',
  );
  const processIncludeAt = memoryPolicy.indexOf(
    '#include "sh_auth_process_failure_policy_fix.h"',
  );
  assert.ok(memoryMacroAt >= 0 && memoryMacroAt < processIncludeAt);
});

test('base auth handler still owns fatal controller teardown', () => {
  const authConfiguration = section(
    webviewSource,
    'void StationheadPlayer::ConfigureAuthWebView()',
    'void StationheadPlayer::CloseWebView()',
  );
  assert.match(
    authConfiguration,
    /add_ProcessFailed\([\s\S]*FinishSpotifyAuthorization\(L"Spotify login WebView failed"\)/,
  );
});

test('browser and main-renderer failures remain fatal', () => {
  for (const kind of [
    'COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED',
    'COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED',
    'COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE',
  ]) {
    assert.match(processPolicy, new RegExp(`case ${kind}:`));
  }
  assert.match(
    processPolicy,
    /IsCriticalStationheadProcessFailure\(kind\)[\s\S]*InvokeEventNoexcept/,
  );
});

test('only trusted Spotify noncritical failures are absorbed', () => {
  assert.match(
    processPolicy,
    /IsTrustedMessageUri\(sourceRaw, origin\)/,
  );
  assert.match(
    processPolicy,
    /IsSpotifyHost\(origin\.host\)/,
  );
  assert.match(
    processPolicy,
    /!IsSpotifyAuthorizationProcessSource\(sender\)[\s\S]*InvokeEventNoexcept/,
  );
  assert.match(
    processPolicy,
    /Keep the interactive OAuth controller alive[\s\S]*return S_OK;/,
  );
});

test('final registration wrapper preserves existing handler outside Spotify auth', () => {
  assert.match(processPolicy, /#undef add_ProcessFailed/);
  assert.match(
    processPolicy,
    /#define add_ProcessFailed\(handler, token\)[\s\S]*WrapStationheadAuthStableProcessFailedHandler\(\(handler\)\)\.Get\(\)/,
  );
  assert.doesNotMatch(processPolicy, /Navigate\(|Reload\(|Close\(/);
});
