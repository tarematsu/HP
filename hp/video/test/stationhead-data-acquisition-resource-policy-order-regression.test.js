import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const webview = readFileSync(
  new URL('../../native/src/sh_webview.cpp', import.meta.url),
  'utf8',
);
const trackBoundary = readFileSync(
  new URL('../../native/src/sh_track_boundary_script.h', import.meta.url),
  'utf8',
);
const policy = readFileSync(
  new URL('../../native/src/sh_data_acquisition_resource_policy_fix.h', import.meta.url),
  'utf8',
);

test('data-safe macro is visible before ConfigureWebView registers resource blocking', () => {
  const includeAt = webview.indexOf('#include "sh_track_boundary_script.h"');
  const configureAt = webview.indexOf('void StationheadPlayer::ConfigureWebView()');
  const applyAt = webview.indexOf('ApplyStationheadResourceBlocking(', configureAt);
  assert.ok(includeAt >= 0 && includeAt < configureAt);
  assert.ok(applyAt > configureAt);
  assert.match(
    trackBoundary,
    /#include "sh_data_acquisition_resource_policy_fix\.h"/,
  );
  assert.match(
    policy,
    /#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingDataSafe/,
  );
});
