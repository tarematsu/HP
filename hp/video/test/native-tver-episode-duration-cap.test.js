import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const part1 = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy_part1.inc', import.meta.url),
  'utf8',
);
const part3a = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy_part3a.inc', import.meta.url),
  'utf8',
);
const episode = `${part1}\n${part3a}`;

test('TVer advances each episode after at most 60 minutes of confirmed program playback', () => {
  assert.match(part1, /episodeMaxPlaybackMs = 60 \* 60 \* 1000/);
  assert.match(part1, /if \(state\.programPlaybackConfirmed && !state\.episodeStartedAt\)/);
  assert.match(part1, /state\.episodeStartedAt = now/);
  assert.match(part1, /armEpisodeLimit\(state\)/);
  assert.match(part1, /Date\.now\(\) - state\.episodeStartedAt < episodeMaxPlaybackMs/);
  assert.match(part1, /postEpisodeEnded\(state\)/);
  assert.match(part1, /homepanel:tver-ended/);
});

test('TVer episode cap survives ad and video replacement state resets', () => {
  assert.match(part3a, /episodeStartedAt: 0/);
  assert.match(part3a, /episodeLimitTimer: 0/);
  const defaults = part3a.slice(
    part3a.indexOf('const playbackDefaults'),
    part3a.indexOf('const clearRuntimeTimers'),
  );
  assert.doesNotMatch(defaults, /episodeStartedAt|episodeLimitTimer/);
  assert.match(part3a, /if \(state\.video !== video\) resetMediaState\(state, video\)/);
});

test('TVer episode cap has both a deadline timer and progress-sample fallback', () => {
  assert.match(part1, /state\.episodeLimitTimer = window\.setTimeout/);
  assert.match(part1, /window\.__homePanelSakuraMeetsState !== state/);
  assert.match(part1, /location\.pathname !== state\.path/);
  assert.match(part1, /if \(enforceEpisodeLimit\(state\)\) return/);
  assert.match(part3a, /clearEpisodeLimitTimer\(state \|\| \{\}\)/);
  assert.doesNotMatch(episode, /location\.replace\(/);
});
