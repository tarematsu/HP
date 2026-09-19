import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const fullscreen = read(
  '../../native/src/renderer_panels/media_tver_playback_policy_force_fullscreen.inc',
);
const episode = read(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy_part3a.inc',
);

test('TVer fullscreen fallback directly requests browser fullscreen after trusted input', () => {
  assert.match(fullscreen, /target\.requestFullscreen/);
  assert.match(fullscreen, /target\.webkitRequestFullscreen/);
  assert.match(fullscreen, /request\.call\(target\)/);
  assert.match(fullscreen, /homepanel:tver-wake/);
});

test('TVer does not advance a naturally ended episode before the 15-minute deadline', () => {
  assert.match(
    episode,
    /const holdUntilDeadline = state\.episodeStartedAt > 0 && !state\.endReported &&[\s\S]*episodeMaxPlaybackMs/,
  );
  assert.match(episode, /video\.loop !== holdUntilDeadline/);
  assert.match(episode, /video\.loop = holdUntilDeadline/);
  assert.match(
    episode,
    /const completedProgram = episodeLimitReached &&[\s\S]*state\.programPlaybackConfirmed/,
  );
  assert.match(episode, /if \(episodeLimitReached && stableEnd && completedItem\)/);
  assert.match(episode, /if \(video\?\.loop\) video\.loop = false/);
});
