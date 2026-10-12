import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const mediaBase = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url), 'utf8');
const tverRuntime = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);
const host = readFileSync(
  new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url), 'utf8');
const youtubePolicy = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_policy.inc', import.meta.url), 'utf8');
const xRuntime = readFileSync(
  new URL('../../native/src/renderer_panels/media_x_following_like.inc', import.meta.url), 'utf8');

test('X runs only for the first two minutes after each native app startup', () => {
  assert.match(mediaBase, /kNativeMediaStartupXPhaseMs = 2U \* 60U \* 1000U/);
  assert.match(mediaBase, /https:\/\/x\.com\/home\?homepanel=startup/);
  assert.match(host, /bool startupXActive_ = true/);
  assert.match(host, /startupXActive_ = true;[\s\S]*CreateControllerForCurrentPhase\(\)/);
  assert.match(host, /const UINT duration = startupXActive_ \? kNativeMediaStartupXPhaseMs : kNativeMediaPhaseMs/);
  assert.match(host, /if \(startupXActive_\) \{\s*startupXActive_ = false;[\s\S]*NavigateCurrentPhase\(\);\s*ArmPhaseTimer\(\)/);
  assert.match(host, /if \(startupXActive_\) \{\s*if \(FAILED\(webview_->Navigate\(kNativeMediaStartupXUrl\)\)\)/);
  assert.match(xRuntime, /homepanel:startup-x-until:v2/);
  assert.match(xRuntime, /location\.assign\(youtubeStart\)/);
  assert.doesNotMatch(mediaBase, /NativeMediaXSlotEnabled|NativeMediaXCyclePlan|NativeMediaXQuietStartSecond/);
  assert.doesNotMatch(host, /kNativeMediaXStartTimer|xPhaseActive_/);
});

test('YouTube and TVer durations remain independently randomized without X interruptions', () => {
  assert.match(mediaBase, /kNativeMediaYoutubeMinContentDurationMinutes = 50U/);
  assert.match(mediaBase, /kNativeMediaYoutubeMaxContentDurationMinutes = 60U/);
  assert.match(mediaBase, /kNativeMediaTverMinContentDurationMinutes = 45U/);
  assert.match(mediaBase, /kNativeMediaTverMaxContentDurationMinutes = 55U/);
  assert.match(mediaBase, /NativeMediaDrawContentPlan\(\)/);
  assert.match(mediaBase, /NativeMediaCurrentYoutubeContentDurationMs\(\)/);
  assert.match(mediaBase, /NativeMediaCurrentTverContentDurationMs\(\)/);
  assert.match(host, /phase_ == Phase::YouTube \? SwitchToTver\(\) : SwitchToYouTube\(\)/);
  assert.doesNotMatch(host, /Navigate\(L"https:\/\/x\.com\/home"\)/);
  assert.doesNotMatch(tverRuntime, /homepanel:tver-x-phase-start/);
});

test('X waits without interaction until the authenticated Following tab exists', () => {
  assert.match(xRuntime, /let tab = followingTab\(\)/);
  assert.match(xRuntime, /while \(!tab && performance\.now\(\) < deadline\)/);
  assert.match(xRuntime, /state\.result = 'waiting-login'/);
  assert.match(xRuntime, /await sleep\(1000\)/);
  assert.doesNotMatch(xRuntime, /attempt < \d+ && !tab/);
  const waitStart = xRuntime.indexOf('let tab = followingTab()');
  const authEnd = xRuntime.indexOf("state.result = 'authenticated'", waitStart);
  const waiting = xRuntime.slice(waitStart, authEnd);
  assert.doesNotMatch(waiting, /scrollTo\(|scrollBy\(/);
});

test('X likes use Following DOM clicks without an existing-like-count threshold and randomize pre-click waits', () => {
  assert.match(xRuntime, /\^\(\?:Following\|フォロー中\)\$/);
  assert.match(xRuntime, /tab\.click\(\)/);
  assert.match(xRuntime, /button\.click\(\)/);
  assert.match(xRuntime, /const likeWaitChoicesMs = \[4 \* 1000, 7 \* 1000, 9 \* 1000\]/);
  assert.doesNotMatch(xRuntime, /minimumExistingLikes/);
  assert.doesNotMatch(xRuntime, /existingLikeCount/);
  assert.doesNotMatch(xRuntime, /parseCompactCount/);
  assert.match(xRuntime, /Math\.floor\(Math\.random\(\) \* likeWaitChoicesMs\.length\)/);
  assert.match(xRuntime, /state\.result = 'waiting-before-like'/);
  assert.match(xRuntime, /await sleep\(waitMs\)/);
  assert.match(xRuntime, /querySelector\('\[data-testid="unlike"\]'\)/);
  assert.match(xRuntime, /const maxLikeAttemptsPerPost = 3/);
  assert.match(xRuntime, /failedAttempts\.set\(candidate\.id, failures\)/);
});

test('X targeted scroll distance is 1.25x the previous setting', () => {
  assert.match(xRuntime, /const maxScrollStepPx = 70/);
  assert.match(xRuntime, /const minScrollStepPx = 25/);
  assert.match(xRuntime, /Math\.ceil\(Math\.abs\(distance\) \* 0\.70\)/);
  assert.match(xRuntime, /state\.result = 'approaching-like'/);
  assert.match(xRuntime, /window\.scrollBy\(\{ top: Math\.sign\(distance\) \* step, behavior: 'smooth' \}\)/);
});

test('X timeline CSS only hides classified repost/promotion rows and placement ads', () => {
  assert.match(xRuntime, /homepanel-x-timeline-filter/);
  assert.match(xRuntime, /data-homepanel-x-filtered/);
  assert.match(xRuntime, /article\[data-testid="tweet"\]:has\(\[data-testid\*="placement" i\]\)/);
  assert.match(xRuntime, /display:\s*none !important/);
  assert.match(xRuntime, /const candidate = scanTimeline\(articles, attempted\)/);
  assert.match(xRuntime, /if \(target\.getAttribute\?\.\(filterAttribute\) !== 'true'\)/);
  assert.match(xRuntime, /target\.hasAttribute\?\.\(filterAttribute\)/);
  assert.doesNotMatch(xRuntime, /article\[data-testid="tweet"\]:has\(\[data-testid="socialContext"\]\)/);
  assert.doesNotMatch(xRuntime, /cellInnerDiv[^`]*socialContext/);
  assert.doesNotMatch(xRuntime, /const promotedText/);
  assert.match(xRuntime, /!element\.closest\?\.\('\[data-testid="tweetText"\]'\)/);
});
