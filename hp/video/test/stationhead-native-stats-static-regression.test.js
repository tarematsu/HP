import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const july19Policy = readFileSync(
  new URL('../../native/src/sh_july19_stats_policy_fix.h', import.meta.url), 'utf8');
const activePolicy = readFileSync(
  new URL('../../native/src/sh_playback_resource_policy_fix.h', import.meta.url), 'utf8');
const messagePolicy = readFileSync(
  new URL('../../native/src/sh_stats_webview_message_policy_fix.h', import.meta.url), 'utf8');
const composition = readFileSync(
  new URL('../../native/src/sh_track_boundary_script.h', import.meta.url), 'utf8');
const playerSource = readFileSync(
  new URL('../../native/src/sh.cpp', import.meta.url), 'utf8');
const webview = readFileSync(
  new URL('../../native/src/sh_webview.cpp', import.meta.url), 'utf8');

test('July 19 auth capture remains in the Stationhead composition', () => {
  assert.match(composition, /#include "sh_july19_stats_policy_fix\.h"/);
  assert.match(
    july19Policy,
    /#define StationheadAuthCaptureScript StationheadJuly19AuthAndLoginSettlementScript/,
  );
  assert.match(july19Policy, /window\.fetch = function\(input, init\)/);
  assert.match(july19Policy, /const NativeXhr = window\.XMLHttpRequest/);
  assert.match(july19Policy, /getHeader\('authorization'\)/);
});
