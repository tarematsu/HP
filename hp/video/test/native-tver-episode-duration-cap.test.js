import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const part1 = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy_part1.inc', import.meta.url),
  'utf8',
);
const part2b = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy_part2b_events.inc', import.meta.url),
  'utf8',
);
const part3a = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy_part3a.inc', import.meta.url),
  'utf8',
);
const episode = `${part1}\n${part2b}\n${part3a}`;

test('TVer never advances an episode from a wall-clock playback deadline', () => {
  assert.doesNotMatch(
    episode,
    /episodeMaxPlaybackMs|episodeStartedAt|episodeLimitTimer|armEpisodeLimit|enforceEpisodeLimit/,
  );
  assert.match(part1, /postMessage\('homepanel:tver-ended'\)/);
});

test('TVer advances only after stable natural completion of the same media item', () => {
  assert.match(part2b, /if \(!state\.programPlaybackConfirmed\)/);
  assert.match(part2b, /state\.maxTime >= Math\.max\(3, state\.maxDuration - 10\)/);
  assert.match(part2b, /state\.endCandidateIdentity = identity/);
  assert.match(part3a, /video\.ended &&/);
  assert.match(part3a, /mediaIdentity\(video\) === state\.endCandidateIdentity/);
  assert.match(part3a, /Date\.now\(\) - state\.endCandidateAt >= postrollGraceMs/);
  assert.match(part3a, /if \(stableEnd && completedItem\)/);
});

test('TVer cancels a transient ended candidate when playback resumes', () => {
  assert.match(part2b, /const clearEndCandidate = \(\) =>/);
  assert.match(part2b, /video\.addEventListener\('play',[\s\S]*clearEndCandidate\(\)/);
  assert.match(part2b, /video\.addEventListener\('playing',[\s\S]*clearEndCandidate\(\)/);
  assert.match(part2b, /video\.addEventListener\('emptied',[\s\S]*clearEndCandidate\(\)/);
});
