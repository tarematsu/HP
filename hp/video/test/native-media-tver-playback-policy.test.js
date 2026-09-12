import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = [
  readFileSync(
    new URL('../../native/src/renderer_panels/media_tver_playback_policy.inc', import.meta.url), 'utf8'),
  readFileSync(
    new URL('../../native/src/renderer_panels/media_tver_playback_policy_guard.inc', import.meta.url), 'utf8'),
  readFileSync(
    new URL('../../native/src/renderer_panels/media_tver_playback_policy_main1.inc', import.meta.url), 'utf8'),
  readFileSync(
    new URL('../../native/src/renderer_panels/media_tver_playback_policy_main2.inc', import.meta.url), 'utf8'),
  readFileSync(
    new URL('../../native/src/renderer_panels/media_tver_playback_policy_force_fullscreen.inc', import.meta.url), 'utf8'),
].join('\n');
const episodeLoop = [
  readFileSync(
    new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url), 'utf8'),
  readFileSync(
    new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy_part1.inc', import.meta.url), 'utf8'),
  readFileSync(
    new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy_part2a.inc', import.meta.url), 'utf8'),
  readFileSync(
    new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy_part2b_observer.inc', import.meta.url), 'utf8'),
  readFileSync(
    new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy_part2b_events.inc', import.meta.url), 'utf8'),
  readFileSync(
    new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy_part3a.inc', import.meta.url), 'utf8'),
  readFileSync(
    new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy_part3b.inc', import.meta.url), 'utf8'),
].join('\n');
const mediaSection = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url), 'utf8');

test('TVer playback policy is scoped to episode pages and one cloud queue', () => {
  assert.match(policy, /kNativeMediaTverPlaybackWatchdogPolicyScript/);
  assert.match(policy, /location\.pathname\.startsWith\('\/episodes\/'\)/);
  assert.match(policy, /episodeQueueKey = '__homePanelTverEpisodeQueue'/);
  assert.doesNotMatch(policy, /__homePanelTverEpisodeQueue:/);
  assert.doesNotMatch(policy, /__homePanelTverSeriesPath|callSeriesSeasons|callSeasonEpisodes/);
});

test('TVer guard rejects navigation outside the cloud queue', () => {
  assert.match(policy, /const guardCloudEpisode = \(\) =>/);
  assert.match(policy, /hrefs\.some\(href =>/);
  assert.match(policy, /if \(!directLaunch\) return requestRestart\(\)/);
  assert.match(policy, /return window\[guardRestartKey\] \? 'restart' : null/);
  assert.doesNotMatch(policy, /__homePanelTverAcceptNextEpisode/);
  assert.doesNotMatch(policy, /location\.replace\('https:\/\/tver\.jp\/series\//);
});

test('TVer direct launch seeds only the current episode until native refresh expands the queue', () => {
  assert.match(policy, /launcherParam = 'homepanel_launch'/);
  assert.match(policy, /const currentHref = normalizeEpisodeHref\(location\.href\)/);
  assert.match(
    policy,
    /sessionStorage\.setItem\(\s*episodeQueueKey, JSON\.stringify\(\{ hrefs: \[currentHref\], index: 0 \}\)\)/,
  );
});

test('TVer ad branch runs before survey and program recovery', () => {
  const adIndex = policy.indexOf('if (adActive) {');
  const restartIndex = policy.indexOf('state && state.restartRequested');
  const surveyIndex = policy.indexOf('const surveyRoots = Array.from');
  const pausedIndex = policy.indexOf('if (video.paused && !video.ended)');
  assert.ok(adIndex >= 0);
  assert.ok(restartIndex > adIndex);
  assert.ok(surveyIndex > restartIndex);
  assert.ok(pausedIndex > surveyIndex);
});

test('TVer ads expose only Skip and fullscreen trusted actions', () => {
  const adIndex = policy.indexOf('if (adActive) {');
  const restartIndex = policy.indexOf('if (state && state.restartRequested)');
  const adBranch = policy.slice(adIndex, restartIndex);
  assert.match(adBranch, /const skipButton = adControls\.find/);
  assert.match(adBranch, /if \(skipButton\) return point\(skipButton\)/);
  assert.match(adBranch, /const fullscreenButton = adControls\.find/);
  assert.match(adBranch, /return fullscreenButton \? point\(fullscreenButton\) : null/);
  assert.doesNotMatch(adBranch, /video\.play\(/);
  assert.doesNotMatch(adBranch, /video\.volume/);
  assert.doesNotMatch(adBranch, /playbackRate/);
  assert.doesNotMatch(adBranch, /surveyRoots/);
});

test('healthy playing TVer content avoids page-wide survey scanning', () => {
  assert.match(policy, /if \(!video \|\| video\.paused\) \{/);
  assert.match(policy, /const surveyRoots = Array\.from\(document\.querySelectorAll/);
  assert.match(policy, /if \(!video\) return null/);
  assert.match(policy, /const root = playerRootFor\(video\)/);
});

test('paused TVer program recovery is idempotent and never toggles the video surface', () => {
  assert.match(policy, /if \(video\.paused && !video\.ended\)/);
  assert.match(policy, /const pending = video\.play\(\)/);
  assert.match(policy, /pending\.catch\(\(\) => \{\}\)/);
  assert.doesNotMatch(policy, /point\(video\)/);
  assert.doesNotMatch(policy, /video\.pause\(/);
  assert.doesNotMatch(policy, /__homePanelTverResumeBlocked/);
  assert.doesNotMatch(policy, /findPlayButton/);
});

test('TVer fullscreen setup is one-shot and still uses the trusted path', () => {
  assert.match(policy, /const browserFullscreen = document\.fullscreenElement/);
  assert.match(policy, /if \(state && state\.fullscreenDirty === false\) return null/);
  assert.match(policy, /if \(fullscreenButton && state\) state\.fullscreenDirty = false/);
  assert.match(policy, /Failure is intentionally not retried until the media identity changes/);
  assert.match(policy, /kNativeMediaTverForceFullscreenAnyMediaScript/);
  assert.match(
    mediaSection,
    /#define kNativeMediaTverForceFullscreenAdSafeScript[\s\S]*kNativeMediaTverForceFullscreenAnyMediaScript[\s\S]*#include "media_trusted_input\.inc"/,
  );
});

test('TVer holds completion for post-roll and drains the full ad pod', () => {
  assert.match(episodeLoop, /postrollGraceMs = 12000/);
  assert.match(episodeLoop, /postrollAfterProgram: false/);
  assert.match(episodeLoop, /const completedProgram = state\.endCandidateAt > 0/);
  assert.ok(episodeLoop.includes('if (!duration || shortAdLength) return true;'));
  assert.match(episodeLoop, /const completedPostroll = state\.postrollAfterProgram/);
  assert.match(episodeLoop, /Date\.now\(\) - state\.endCandidateAt >= postrollGraceMs/);
});

test('TVer program volume stays at 100 percent while ads remain untouched', () => {
  assert.match(episodeLoop, /const targetVolume = 1\.0/);
  assert.match(episodeLoop, /const enforceVolume = video =>/);
  const adStart = episodeLoop.indexOf('if (advertisementActive) {');
  const adEnd = episodeLoop.indexOf('if (state.adActive) {', adStart);
  const adBranch = episodeLoop.slice(adStart, adEnd);
  assert.doesNotMatch(adBranch, /enforceVolume\(/);
  assert.doesNotMatch(adBranch, /video\.volume/);
  assert.doesNotMatch(adBranch, /video\.playbackRate/);
  assert.match(policy, /video\.volume !== 1\.0/);
});

test('event policy wakes native recovery only while fullscreen remains pending', () => {
  assert.match(episodeLoop, /homepanel:tver-wake/);
  assert.match(episodeLoop, /if \(video\.paused && !video\.ended\) recoveryFlags\.push\('paused'\)/);
  assert.match(episodeLoop, /!browserFullscreen && state\.fullscreenDirty/);
  assert.match(episodeLoop, /window\.__homePanelTverAdActive = true;[\s\S]*wakeNative\('ad:'/);
  assert.match(episodeLoop, /fullscreenchange[\s\S]*wakeNative\('fullscreen-change:'/);
  assert.match(episodeLoop, /restartRequested = true;[\s\S]*wakeNative\('restart:'/);
});
