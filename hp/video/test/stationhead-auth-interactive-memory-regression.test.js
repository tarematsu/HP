import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const navigationPolicy = readFileSync(
  new URL('../../native/src/sh_auth_navigation_policy_fix.h', import.meta.url),
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

test('auth policy chain retains process-failure policy without a memory override layer', () => {
  const captureAt = navigationPolicy.indexOf(
    '#include "sh_auth_capture_validation_policy_fix.h"',
  );
  const processAt = navigationPolicy.indexOf(
    '#include "sh_auth_process_failure_policy_fix.h"',
  );
  assert.ok(captureAt >= 0 && captureAt < processAt);
  assert.doesNotMatch(navigationPolicy, /sh_auth_interactive_memory_policy_fix/);
});

test('ConfigureAuthWebView leaves memory targeting to the shared Stationhead layout', () => {
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
  assert.doesNotMatch(navigationPolicy, /kInteractiveAuthMemoryTarget/);
  assert.doesNotMatch(navigationPolicy, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_(?:LOW|NORMAL)/);
  assert.doesNotMatch(navigationPolicy, /put_MemoryUsageTargetLevel/);
});

test('playback and auth layout always force the LOW WebView2 memory target', () => {
  assert.match(layoutSource, /void SetControllerMemoryUsageTarget\(/);
  assert.match(layoutSource, /put_MemoryUsageTargetLevel\(level\)/);
  assert.match(
    layoutSource,
    /SetControllerMemoryUsageTarget\(\s*controller,\s*COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW\s*\);/,
  );
  assert.match(
    layoutSource,
    /SetControllerMemoryUsageTarget\(\s*authController,\s*COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW\s*\);/,
  );
  assert.doesNotMatch(layoutSource, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL/);
  assert.match(layoutSource, /controller->put_IsVisible\(playbackControllerVisible\)/);
  assert.match(layoutSource, /authController->put_IsVisible\(TRUE\)/);
});
