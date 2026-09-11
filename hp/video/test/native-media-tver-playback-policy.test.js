import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_playback_policy.inc', import.meta.url),
  'utf8',
);
const episodeLoop = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url),
  'utf8',
);
const mediaSection = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);

test('TVer playback policy is scoped to episode pages', () => {
  assert.match(policy, /kNativeMediaTverPlaybackWatchdogPolicyScript/);
  assert.match(policy, /location\.pathname\.startsWith\('\/episodes\/'\)/);
  assert.doesNotMatch(policy, /callSeriesSeasons/);
  assert.doesNotMatch(policy, /callSeasonEpisodes/);
});

test('TVer playback policy rejects episodes outside the stored cloud queue without opening a series page', () => {
  assert.match(policy, /seriesPathKey = '__homePanelTverSeriesPath'/);
  assert.match(policy, /__homePanelTverEpisodeQueue:/);
  assert.match(policy, /__homePanelTverAcceptNextEpisode:/);
  assert.match(policy, /const guardSeriesEpisode = \(\) =>/);
  assert.match(policy, /hrefs\.some\(href =>/);
  assert.match(policy, /new URL\(href\)\.pathname === location\.pathname/);
  assert.match(policy, /if \(!directLaunch\) return requestRestart\(\)/);
  assert.match(policy, /return window\[guardRestartKey\] \? 'restart' : null/);
  assert.doesNotMatch(policy, /location\.replace\('https:\/\/tver\.jp' \+ seriesPath\)/);
  assert.doesNotMatch(policy, /location\.replace\('https:\/\/tver\.jp\/series\//);
});

test('TVer accepted episode guard is cached for the document lifetime', () => {
  assert.match(policy, /guardedEpisodePathKey = '__homePanelTverGuardedEpisodePath'/);
  assert.match(policy, /window\[guardedEpisodePathKey\] === location\.pathname/);
  assert.match(policy, /window\[guardedEpisodePathKey\] = location\.pathname/);
});

test('TVer direct launch or trusted action seeds a one-item queue', () => {
  assert.match(policy, /launcherParam = 'homepanel_launch'/);
  assert.match(policy, /acceptNextEpisode = sessionStorage\.getItem\(pendingKey\) === '1'/);
  assert.match(policy, /sessionStorage\.removeItem\(pendingKey\)/);
  assert.match(policy, /if \(!directLaunch && !acceptNextEpisode\) return requestRestart\(\)/);
  assert.match(policy, /JSON\.stringify\(\{ hrefs: \[currentHref\], index: 0 \}\)/);
});

test('TVer survey scan stays inside modal or survey roots', () => {
  const guardIndex = policy.indexOf('if (!guardSeriesEpisode()) {');
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
});

test('paused TVer media recovers idempotently during programs and ads', () => {
  const pausedIndex = policy.indexOf('if (video.paused && !video.ended)');
  const fullscreenIndex = policy.indexOf('const browserFullscreen');
  assert.ok(pausedIndex >= 0);
  assert.ok(fullscreenIndex > pausedIndex);
  assert.match(policy, /const findPlayButton = \(\) => playerControls\(\)\.find/);
  assert.match(policy, /const pending = video\.play\(\)/);
  assert.match(policy, /video\.__homePanelTverResumeBlocked/);
  assert.match(policy, /const playButton = findPlayButton\(\)/);
  assert.doesNotMatch(policy, /if \(\(state && state\.adActive\) \|\| window\.__homePanelTverAdActive\) return null/);
  assert.doesNotMatch(policy, /video\.pause\(/);
});

test('TVer keeps actual browser fullscreen authoritative and allows ads fullscreen', () => {
  assert.match(policy, /const browserFullscreen = document\.fullscreenElement/);
  assert.match(policy, /if \(browserFullscreen\)[\s\S]*state\.fullscreenDirty = false/);
  assert.match(policy, /if \(state\) state\.fullscreenDirty = true/);
  assert.match(policy, /fullscreenButton \? point\(fullscreenButton\) : point\(video\)/);
  assert.match(policy, /kNativeMediaTverForceFullscreenAnyMediaScript/);
  assert.doesNotMatch(
    policy,
    /kNativeMediaTverForceFullscreenAnyMediaScript[\s\S]*adActive[\s\S]*return/,
  );
  assert.match(
    mediaSection,
    /#define kNativeMediaTverForceFullscreenAdSafeScript[\s\S]*kNativeMediaTverForceFullscreenAnyMediaScript[\s\S]*#include "media_trusted_input\.inc"/,
  );
});

test('TVer holds program completion long enough for post-roll and drains the full ad pod', () => {
  assert.match(episodeLoop, /postrollGraceMs = 12000/);
  assert.match(episodeLoop, /postrollAfterProgram: false/);
  assert.match(episodeLoop, /const completedProgram = state\.endCandidateAt > 0/);
  assert.match(episodeLoop, /if \(!state\.adActive\) state\.postrollAfterProgram = completedProgram/);
  assert.match(episodeLoop, /if \(!duration \|\| shortAdLength\) return true/);
  assert.match(episodeLoop, /return explicitAdMarker\(video\)/);
  assert.match(episodeLoop, /const completedPostroll = state\.postrollAfterProgram/);
  assert.match(episodeLoop, /if \(completedPostroll\)[\s\S]*advanceEpisodeOrSeries\(\)/);
  assert.match(episodeLoop, /Date\.now\(\) - state\.endCandidateAt >= postrollGraceMs/);
});

test('TVer program and ad media are pinned to full player volume', () => {
  assert.match(episodeLoop, /const targetVolume = 1\.0/);
  assert.match(episodeLoop, /const enforceVolume = video =>/);
  assert.match(episodeLoop, /if \(video\.muted\) video\.muted = false/);
  assert.match(episodeLoop, /video\.volume !== targetVolume/);
  assert.match(episodeLoop, /addEventListener\('volumechange'/);
  assert.match(policy, /if \(video\.volume !== 1\.0\) video\.volume = 1\.0/);
});

test('episode-page restart and fullscreen recovery remain intact', () => {
  assert.match(policy, /state && state\.restartRequested/);
  assert.match(policy, /window\.__homePanelSakuraMeetsState/);
  assert.match(policy, /fullscreenButton \? point\(fullscreenButton\) : point\(video\)/);
});
