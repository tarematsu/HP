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

test('PR48 stats rollback restores authenticated A polling without restoring B network auth', () => {
  assert.match(activePolicy, /const headers = window\.__homepanelStationheadAuthHeaders/);
  assert.match(activePolicy, /if \(!headers\?\.authorization\)/);
  assert.match(activePolicy, /error: 'no-auth-header'/);
  assert.match(activePolicy, /Date\.now\(\) - lastSuccessAt < 10 \* 60 \* 1000/);
  assert.doesNotMatch(activePolicy, /const requestHeaders = \{ accept: 'application\/json' \}/);

  assert.match(
    finalInteractionPolicy,
    /#define StationheadAuthProbeScript StationheadCurrentInteractionAuthProbeScript/,
  );
  const localProbeAt = finalInteractionPolicy.indexOf(
    'inline std::wstring StationheadCurrentInteractionAuthProbeScript',
  );
  assert.ok(localProbeAt >= 0);
  const localProbeEnd = finalInteractionPolicy.indexOf(
    'inline constexpr int64_t kStationheadMeasuredPostPlaybackStopClickDelayMs',
    localProbeAt,
  );
  assert.ok(localProbeEnd > localProbeAt);
  const localProbe = finalInteractionPolicy.slice(localProbeAt, localProbeEnd);
  assert.match(localProbe, /__homepanelStationheadBlockingLoginVisible/);
  assert.doesNotMatch(localProbe, /streakStats|fetch\s*\(/);
});
