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

test('TVer playback policy rejects episodes outside the stored series queue', () => {
  assert.match(policy, /seriesPathKey = '__homePanelTverSeriesPath'/);
  assert.match(policy, /__homePanelTverEpisodeQueue:/);
  assert.match(policy, /__homePanelTverAcceptNextEpisode:/);
  assert.match(policy, /const guardSeriesEpisode = \(\) =>/);
  assert.match(policy, /hrefs\.some\(href =>/);
  assert.match(policy, /new URL\(href\)\.pathname === location\.pathname/);
  assert.match(policy, /location\.replace\('https:\/\/tver\.jp' \+ seriesPath\)/);
  assert.match(policy, /if \(!guardSeriesEpisode\(\)\) return null/);
});

test('TVer accepted episode guard is cached for the document lifetime', () => {
  assert.match(policy, /guardedEpisodePathKey = '__homePanelTverGuardedEpisodePath'/);
  assert.match(policy, /window\[guardedEpisodePathKey\] === location\.pathname/);
  assert.match(policy, /window\[guardedEpisodePathKey\] = location\.pathname/);
});

test('TVer action fallback accepts exactly one episode and seeds a one-item queue', () => {
  assert.match(policy, /acceptNextEpisode = sessionStorage\.getItem\(pendingKey\) === '1'/);
  assert.match(policy, /sessionStorage\.removeItem\(pendingKey\)/);
  assert.match(policy, /JSON\.stringify\(\{ hrefs: \[currentHref\], index: 0 \}\)/);
  assert.match(policy, /if \(acceptNextEpisode && currentHref\)/);
});

test('TVer survey scan stays inside modal or survey roots', () => {
  const guardIndex = policy.indexOf('if (!guardSeriesEpisode()) return null');
  const surveyIndex = policy.indexOf('const surveyRoots = Array.from');
  const stateIndex = policy.indexOf('const state = window.__homePanelSakuraMeetsState');
  assert.ok(guardIndex >= 0);
  assert.ok(surveyIndex > guardIndex);
  assert.ok(stateIndex > surveyIndex);
  assert.match(policy, /\[role="dialog"\], \[aria-modal="true"\]/);
  assert.match(policy, /root\.querySelectorAll\(/);
  assert.match(policy, /閉じる\|とじる\|close\|dismiss/);
  assert.match(policy, /アンケート\|ご回答\|回答する\|誕生年\|誕生月\|性別/);
  assert.match(policy, /if \(surveyClose\) return point\(surveyClose\)/);
  assert.doesNotMatch(
    policy,
    /const controls = Array\.from\(document\.querySelectorAll\(\s*'button, \[role="button"\], a, \[aria-label\], \[title\]'/,
  );
});

test('paused TVer episodes recover idempotently before building control lists', () => {
  const pausedIndex = policy.indexOf('if (video.paused && !video.ended)');
  const fullscreenIndex = policy.indexOf('state && state.fullscreenDirty === false');
  assert.ok(pausedIndex >= 0);
  assert.ok(fullscreenIndex > pausedIndex);
  assert.match(policy, /const findPlayButton = \(\) => playerControls\(\)\.find/);
  assert.match(policy, /const pending = video\.play\(\)/);
  assert.match(policy, /video\.__homePanelTverResumeBlocked/);
  assert.match(policy, /const playButton = findPlayButton\(\)/);
  assert.doesNotMatch(policy, /return point\(video\)/);
  assert.doesNotMatch(policy, /video\.pause\(/);
});

test('healthy TVer playback exits before a player-wide control scan', () => {
  const cleanFullscreenIndex = policy.indexOf(
    'if (state && state.fullscreenDirty === false) return null',
  );
  const controlsIndex = policy.indexOf('const controls = playerControls()');
  assert.ok(cleanFullscreenIndex >= 0);
  assert.ok(controlsIndex > cleanFullscreenIndex);
  assert.match(policy, /depth < 5/);
  assert.match(policy, /root\.querySelectorAll\(/);
});

test('episode-page restart, ad, and fullscreen guards remain intact', () => {
  assert.match(policy, /state && state\.restartRequested/);
  assert.match(policy, /state && state\.adActive/);
  assert.match(policy, /window\.__homePanelTverAdActive/);
  assert.match(policy, /state && state\.fullscreenDirty === false/);
  assert.match(policy, /fullscreenButton \? point\(fullscreenButton\) : null/);
});