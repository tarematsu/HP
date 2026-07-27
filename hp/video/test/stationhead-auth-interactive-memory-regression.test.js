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

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

function occurrences(source, fragment) {
  return source.split(fragment).length - 1;
}

test('interactive auth memory policy is the final auth policy layer', () => {
  const captureAt = navigationPolicy.indexOf(
    '#include "sh_auth_capture_validation_policy_fix.h"',
  );
  const memoryAt = navigationPolicy.indexOf(
    '#include "sh_auth_interactive_memory_policy_fix.h"',
  );
  assert.ok(captureAt >= 0 && captureAt < memoryAt);
});

test('Stationhead uses LOW memory target only in the interactive auth controller path', () => {
  assert.equal(
    occurrences(webviewSource, 'COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW'),
    1,
  );
  const authConfiguration = section(
    webviewSource,
    'void StationheadPlayer::ConfigureAuthWebView()',
    'void StationheadPlayer::CloseWebView()',
  );
  assert.match(
    authConfiguration,
    /authV19->put_MemoryUsageTargetLevel\(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW\)/,
  );
});

test('interactive auth LOW request is compiled as NORMAL', () => {
  assert.match(
    memoryPolicy,
    /kInteractiveAuthMemoryTarget\s*=\s*COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL/,
  );
  assert.match(
    memoryPolicy,
    /#undef COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/,
  );
  assert.match(
    memoryPolicy,
    /#define COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW[\s\\]*::hp::stationhead_auth_memory_policy::kInteractiveAuthMemoryTarget/,
  );
  assert.match(
    memoryPolicy,
    /static_assert\(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW !=[\s\S]*COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL\)/,
  );
});

test('playback controller memory behavior remains separate from auth override', () => {
  const playbackConfiguration = section(
    webviewSource,
    'void StationheadPlayer::ConfigureWebView()',
    'void StationheadPlayer::ConfigureAuthWebView()',
  );
  assert.doesNotMatch(
    playbackConfiguration,
    /put_MemoryUsageTargetLevel/,
  );
});
