import assert from 'node:assert/strict';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const runtime = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);

test('TVer never advances an episode from a wall-clock playback deadline', () => {
  assert.doesNotMatch(
    runtime,
    /episodeMaxPlaybackMs|episodeStartedAt|episodeLimitTimer|armEpisodeLimit|enforceEpisodeLimit/,
  );
  assert.match(runtime, /post\('homepanel:tver-ended'\)/);
});

test('TVer advances only after natural completion of the active program media', () => {
  assert.match(runtime, /event\.type === 'ended'/);
  assert.match(runtime, /key === state\.programKey/);
  assert.match(runtime, /length >= 5/);
  assert.match(runtime, /at >= Math\.max\(3, length - 10\)/);
  assert.match(runtime, /state\.programEndPending = true/);
  assert.match(runtime, /if \(state\.programEndPending && !state\.endReported\)/);
});

test('TVer media replacement cannot inherit an old natural-end signal', () => {
  assert.match(runtime, /if \(state\.mediaKey !== key\) \{/);
  assert.match(runtime, /state\.mediaKey = key/);
  assert.match(runtime, /state\.programCandidateKey = key/);
  assert.doesNotMatch(runtime, /endCandidateAt|endCandidateIdentity|postrollGraceMs/);
});
