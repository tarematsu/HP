import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const navigationPolicy = readFileSync(
  new URL('../../native/src/sh_auth_navigation_policy_fix.h', import.meta.url),
  'utf8',
);
const memoryPolicy = readFileSync(
  new URL('../../native/src/sh_auth_interactive_memory_policy_fix.h', import.meta.url),
  'utf8',
);
const webviewSource = readFileSync(
  new URL('../../native/src/sh_webview.cpp', import.meta.url),
  'utf8',
);
const layoutSource = readFileSync(
  new URL('../../native/src/sh_layout.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('auth policy chain retains process-failure policy after memory override removal', () => {
  const captureAt = navigationPolicy.indexOf(
    '#include "sh_auth_capture_validation_policy_fix.h"',
  );
  const memoryAt = navigationPolicy.indexOf(
    '#include "sh_auth_interactive_memory_policy_fix.h"',
  );
  assert.ok(captureAt >= 0 && captureAt < memoryAt);
  assert.match(memoryPolicy, /#include "sh_auth_process_failure_policy_fix\.h"/);
});

test('ConfigureAuthWebView leaves the WebView2 memory target unmanaged', () => {
  const authConfiguration = section(
    webviewSource,
    'void StationheadPlayer::ConfigureAuthWebView()',
    'void StationheadPlayer::CloseWebView()',
  );
  assert.doesNotMatch(authConfiguration, /put_MemoryUsageTargetLevel/);
  assert.doesNotMatch(authConfiguration, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_(?:LOW|NORMAL)/);
  assert.doesNotMatch(authConfiguration, /ICoreWebView2_19/);
});

test('obsolete interactive auth memory-target remapping is absent', () => {
  assert.doesNotMatch(memoryPolicy, /kInteractiveAuthMemoryTarget/);
  assert.doesNotMatch(memoryPolicy, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_(?:LOW|NORMAL)/);
  assert.doesNotMatch(memoryPolicy, /put_MemoryUsageTargetLevel/);
});

test('playback and auth layout do not override WebView2 memory targets', () => {
  assert.doesNotMatch(layoutSource, /SetControllerMemoryUsageTarget/);
  assert.doesNotMatch(layoutSource, /put_MemoryUsageTargetLevel/);
  assert.doesNotMatch(layoutSource, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_(?:LOW|NORMAL)/);
  assert.match(layoutSource, /controller->put_IsVisible\(playbackControllerVisible\)/);
  assert.match(layoutSource, /authController->put_IsVisible\(TRUE\)/);
});
