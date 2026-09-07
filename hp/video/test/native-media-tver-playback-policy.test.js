import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_playback_policy.inc', import.meta.url),
  'utf8',
);

test('TVer playback policy is scoped to episode pages', () => {
  assert.match(policy, /kNativeMediaTverPlaybackWatchdogPolicyScript/);
  assert.match(policy, /location\.pathname\.startsWith\('\/episodes\/'\)/);
  assert.doesNotMatch(policy, /callSeriesSeasons/);
  assert.doesNotMatch(policy, /callSeasonEpisodes/);
});

test('TVer playback policy dismisses a survey before touching the player', () => {
  const surveyIndex = policy.indexOf('const surveyClose = controls.find');
  const stateIndex = policy.indexOf('const state = window.__homePanelSakuraMeetsState');
  assert.ok(surveyIndex >= 0);
  assert.ok(stateIndex > surveyIndex);
  assert.match(policy, /閉じる\|とじる\|close\|dismiss/);
  assert.match(policy, /アンケート\|ご回答\|回答する\|誕生年\|誕生月\|性別/);
  assert.match(policy, /if \(surveyClose\) return point\(surveyClose\)/);
});

test('stopped TVer episodes prioritize a trusted play click before fullscreen', () => {
  const pausedIndex = policy.indexOf('video.paused && !video.ended');
  const fullscreenIndex = policy.indexOf('state && state.fullscreenDirty === false');
  assert.ok(pausedIndex >= 0);
  assert.ok(fullscreenIndex > pausedIndex);
  assert.match(policy, /const playButton = controls\.find/);
  assert.match(policy, /再生/);
  assert.match(policy, /play(?: video)?/);
  assert.match(policy, /if \(playButton\) return point\(playButton\)/);
  assert.match(policy, /if \(video\) return point\(video\)/);
});

test('episode-page restart, ad, and fullscreen guards remain intact', () => {
  assert.match(policy, /state && state\.restartRequested/);
  assert.match(policy, /state && state\.adActive/);
  assert.match(policy, /window\.__homePanelTverAdActive/);
  assert.match(policy, /state && state\.fullscreenDirty === false/);
  assert.match(policy, /fullscreenButton \? point\(fullscreenButton\) : null/);
});
