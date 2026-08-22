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

test('PR48 stats rollback does not restore the old Window B network auth probe', () => {
  assert.match(activePolicy, /if \(!headers\?\.authorization\)/);
  assert.match(activePolicy, /Date\.now\(\) - lastSuccessAt < 10 \* 60 \* 1000/);
  assert.match(
    finalInteractionPolicy,
    /#define StationheadAuthProbeScript StationheadCurrentInteractionAuthProbeScript/,
  );
  const localProbeAt = finalInteractionPolicy.indexOf(
    'inline std::wstring StationheadCurrentInteractionAuthProbeScript',
  );
  assert.ok(localProbeAt >= 0);
  const localProbe = finalInteractionPolicy.slice(localProbeAt);
  assert.match(localProbe, /__homepanelStationheadBlockingLoginVisible/);
  assert.doesNotMatch(localProbe, /streakStats|fetch\(/);
});
