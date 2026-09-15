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

test('authenticated stats polling retains its bounded retry behavior', () => {
  assert.match(activePolicy, /const headers = window\.__homepanelStationheadAuthHeaders/);
  assert.match(activePolicy, /if \(!headers\?\.authorization\)/);
  assert.match(activePolicy, /error: 'no-auth-header'/);
  assert.match(activePolicy, /Date\.now\(\) - lastSuccessAt < 10 \* 60 \* 1000/);
  assert.doesNotMatch(activePolicy, /const requestHeaders = \{ accept: 'application\/json' \}/);
});

test('interaction bridge remains local and network-free', () => {
  const bridgeAt = finalInteractionPolicy.indexOf(
    'inline std::wstring StationheadAutoplayScriptCurrentInteraction',
  );
  assert.ok(bridgeAt >= 0);
  const bridgeEnd = finalInteractionPolicy.indexOf(
    '#define kStationheadPostPlaybackStopClickDelayMs',
    bridgeAt,
  );
  assert.ok(bridgeEnd > bridgeAt);
  const bridge = finalInteractionPolicy.slice(bridgeAt, bridgeEnd);
  assert.match(bridge, /__homepanelStationheadBlockingLoginVisible/);
  assert.doesNotMatch(bridge, /streakStats|fetch\s*\(/);
});
