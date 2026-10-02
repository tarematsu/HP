import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const activePolicy = readFileSync(
  new URL('../../native/src/sh_playback_resource_policy_fix.h', import.meta.url),
  'utf8',
);
const finalInteractionPolicy = readFileSync(
  new URL('../../native/src/sh_track_boundary_message_policy.h', import.meta.url),
  'utf8',
);
const compactRuntime = readFileSync(
  new URL('../../native/src/sh_compact_runtime_script.h', import.meta.url),
  'utf8',
);

test('authenticated stats polling retains its bounded retry behavior', () => {
  assert.match(activePolicy, /const headers = window\.__homepanelStationheadAuthHeaders/);
  assert.match(activePolicy, /if \(!headers\?\.authorization\)/);
  assert.match(activePolicy, /error: 'no-auth-header'/);
  assert.match(activePolicy, /Date\.now\(\) - lastSuccessAt < 10 \* 60 \* 1000/);
  assert.doesNotMatch(activePolicy, /const requestHeaders = \{ accept: 'application\/json' \}/);
});

test('legacy interaction wrapper is bypassed by an event-driven compatibility bridge', () => {
  const bridgeAt = finalInteractionPolicy.indexOf(
    'inline std::wstring StationheadAutoplayScriptCurrentInteraction',
  );
  assert.ok(bridgeAt >= 0);
  const bridgeEnd = finalInteractionPolicy.indexOf(
    '#define kStationheadPostPlaybackStopClickDelayMs',
    bridgeAt,
  );
  assert.ok(bridgeEnd > bridgeAt);
  const legacyBridge = finalInteractionPolicy.slice(bridgeAt, bridgeEnd);

  const compatAt = compactRuntime.indexOf(
    'inline std::wstring StationheadAutoplayScriptRuntimeFixed',
  );
  assert.ok(compatAt >= 0);
  const compatBridge = compactRuntime.slice(compatAt);

  assert.match(legacyBridge, /window\.__homepanelStationheadInteractionBridge/);
  assert.match(legacyBridge, /nativeSetInterval\(publish, 1000\)/);
  assert.match(compatBridge, /window\.__homepanelStationheadInteractionBridge = true/);
  assert.match(
    compatBridge,
    /addEventListener\('homepanel-stationhead-auth-ready',[\s\S]*publish\(\)/,
  );
  assert.match(compatBridge, /type: 'stationhead-auth-ready'/);
  assert.match(compatBridge, /source: 'current-interaction-state'/);
  assert.doesNotMatch(compatBridge, /setInterval\s*\(/);
  assert.doesNotMatch(compatBridge, /streakStats|fetch\s*\(/);
});