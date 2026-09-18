import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const navigationPolicy = readFileSync(
  new URL('../../native/src/sh_auth_navigation_policy_fix.h', import.meta.url),
  'utf8',
);
const processPolicy = readFileSync(
  new URL('../../native/src/sh_auth_process_failure_policy_fix.h', import.meta.url),
  'utf8',
);
const sharedProcessPolicy = readFileSync(
  new URL('../../native/src/sh_process_failure_policy_fix.h', import.meta.url),
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

test('auth process-failure policy remains in the final policy chain without a memory-target override', () => {
  assert.match(navigationPolicy, /#include "sh_auth_process_failure_policy_fix\.h"/);
  assert.doesNotMatch(navigationPolicy, /kInteractiveAuthMemoryTarget/);
  assert.doesNotMatch(
    navigationPolicy,
    /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_(?:LOW|NORMAL)|put_MemoryUsageTargetLevel/,
  );
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

test('browser and main-renderer exits remain immediately fatal', () => {
  for (const kind of [
    'COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED',
    'COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED',
  ]) {
    assert.match(processPolicy, new RegExp(`case ${kind}:`));
    assert.match(sharedProcessPolicy, new RegExp(kind));
  }
  assert.doesNotMatch(
    processPolicy,
    /case COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE:/,
  );
});

test('renderer unresponsive requires two observations within fifteen seconds', () => {
  assert.match(
    sharedProcessPolicy,
    /kRendererUnresponsiveConfirmWindowMs =\s*15ULL \* 1000ULL/,
  );
  assert.match(
    sharedProcessPolicy,
    /COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE/,
  );
  assert.match(sharedProcessPolicy, /rendererUnresponsiveCount\.fetch_add/);
  assert.match(sharedProcessPolicy, /if \(count < 2\) return false/);
  assert.match(
    processPolicy,
    /ShouldForwardStationheadProcessFailure\(args\)/,
  );
});

test('transient GPU utility frame and helper failures do not recreate playback or auth', () => {
  assert.match(
    sharedProcessPolicy,
    /GPU, frame-only, utility, sandbox-helper and other transient child/,
  );
  assert.match(
    sharedProcessPolicy,
    /return false;[\s\S]*RENDER_PROCESS_UNRESPONSIVE/,
  );
  assert.match(
    processPolicy,
    /spotifyAuthorization &&[\s\S]*!IsCriticalStationheadProcessFailure\(kind\) && !unresponsive[\s\S]*return S_OK/,
  );
  assert.match(
    processPolicy,
    /All other playback-process failures are absorbed here/,
  );
});

test('final registration wrapper uses the unified process classifier', () => {
  assert.match(processPolicy, /#undef add_ProcessFailed/);
  assert.match(
    processPolicy,
    /#define add_ProcessFailed\(handler, token\)[\s\S]*WrapStationheadAuthStableProcessFailedHandler\(\(handler\)\)\.Get\(\)/,
  );
  assert.match(
    processPolicy,
    /stationhead_process_failure_policy::[\s\S]*ShouldForwardStationheadProcessFailure/,
  );
  assert.doesNotMatch(processPolicy, /Navigate\(|Reload\(|Close\(/);
});
