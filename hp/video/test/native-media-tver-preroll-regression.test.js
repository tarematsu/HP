import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adPolicy = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy_part2a.inc', import.meta.url),
  'utf8',
);
const events = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy_part2b_events.inc', import.meta.url),
  'utf8',
);

test('initial short TVer media is treated as pre-roll instead of an episode', () => {
  assert.match(adPolicy, /const startupShortMedia = state\.maxTime < 5 && shortAdLength/);
  assert.match(
    adPolicy,
    /if \(startupShortMedia \|\| replacementVideo \|\| sameVideoReset\) return true/,
  );
});

test('an ad ended event cannot arm native episode advancement', () => {
  const endedStart = events.indexOf("video.addEventListener('ended'");
  const waitingStart = events.indexOf("for (const eventName of ['waiting', 'stalled'])", endedStart);
  assert.ok(endedStart >= 0);
  assert.ok(waitingStart > endedStart);
  const endedBranch = events.slice(endedStart, waitingStart);
  assert.match(endedBranch, /state\.adActive \|\| detectAd\(video, state\)/);
  assert.match(endedBranch, /scheduleEnsure\(0\)/);
  const guardIndex = endedBranch.indexOf('detectAd(video, state)');
  const completionIndex = endedBranch.indexOf('state.endCandidateAt = Date.now()');
  assert.ok(guardIndex >= 0);
  assert.ok(completionIndex > guardIndex);
});
