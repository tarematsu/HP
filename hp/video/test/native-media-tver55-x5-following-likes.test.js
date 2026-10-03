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

test('media cycle randomly selects zero, one or two X slots once per X-YouTube-X-TVer cycle', () => {
  assert.match(mediaBase, /struct NativeMediaXCyclePlan/);
  assert.match(mediaBase, /const UINT count = NativeMediaXRandomBelow\(3\)/);
  assert.match(mediaBase, /if \(count == 2\)[\s\S]*firstSlot = true[\s\S]*secondSlot = true/);
  assert.match(mediaBase, /else if \(count == 1\)[\s\S]*NativeMediaXRandomBelow\(2\)/);
  assert.match(mediaBase, /if \(tver\) \{[\s\S]*NativeMediaCurrentXCyclePlan\(\) = NativeMediaDrawXCyclePlan\(\)/);
  assert.match(mediaBase, /NativeMediaXSlotEnabled\(true\)/);
  assert.match(mediaBase, /NativeMediaXSlotEnabled\(false\)/);
});

test('unused X slots are skipped and TVer never extends itself for X', () => {
  assert.match(mediaBase, /return startupPrefix \+ youtubeContentDurationMs \+ 1000U/);
  assert.match(mediaBase, /return NativeMediaCurrentTverContentDurationMs\(\) \+ 1000U/);
  assert.match(
    mediaBase,
    /if \(tver\) \{[\s\S]*NativeMediaStartupYoutubePhaseActive\(\) = false;[\s\S]*return NativeMediaCurrentTverContentDurationMs\(\);/,
  );
  assert.match(mediaBase, /const UINT tailX = NativeMediaXSlotEnabled\(false\)/);
  assert.match(mediaBase, /#define kNativeMediaYoutubeContentPhaseMs NativeMediaYoutubeContentIntervalMs\(\)/);
  assert.match(mediaBase, /#define kNativeMediaTverContentDurationMs NativeMediaTverContentIntervalMs\(\)/);
  assert.doesNotMatch(
    mediaBase,
    /return tverContentDurationMs \+[\s\S]*NativeMediaXSlotEnabled\(true\) \? kNativeMediaXPhaseMs : 0U/,
  );
  assert.doesNotMatch(mediaBase, /return phaseDuration \+ 1000U/);
  assert.doesNotMatch(mediaBase, /return kNativeMediaTverPhaseMs \+ 1000U/);
});

test('the first X slot is a YouTube prefix at startup and after TVer', () => {
  assert.match(mediaBase, /kNativeMediaStartupXPhaseMs = 2U \* 60U \* 1000U/);
  assert.match(mediaBase, /https:\/\/x\.com\/home\?homepanel=startup/);
  assert.match(mediaBase, /NativeMediaStartupYoutubePhaseActive/);
  assert.match(
    mediaBase,
    /const bool prefixXEnabled =[\s\S]*NativeMediaCurrentXCyclePlan\(\)\.firstSlot[\s\S]*NativeMediaXRuntimeAllowed\(\)[\s\S]*!gNativeMediaPowerSaving/,
  );
  assert.match(mediaBase, /NativeMediaStartupXDeadlineTick\(\) =[\s\S]*prefixXEnabled \? now \+ kNativeMediaStartupXPhaseMs : 1/);
  assert.match(mediaBase, /const bool startupXEnabled =[\s\S]*NativeMediaXSlotEnabled\(true\) && NativeMediaXRuntimeAllowed\(\)/);
  assert.match(mediaBase, /NativeMediaStartupYoutubePhaseActive\(\) = startupXEnabled/);
  assert.match(mediaBase, /return startupPrefix \+ youtubeContentDurationMs \+ tailX/);
  assert.match(xRuntime, /homepanel:startup-x-until:v2/);
  assert.match(xRuntime, /homepanel=startup/);
  assert.match(xRuntime, /Date\.now\(\) \+ 120 \* 1000/);
  assert.match(xRuntime, /location\.assign\(youtubeStart\)/);
});

test('YouTube draws one stable 45-75 minute content duration and can hand off to X', () => {
  assert.match(mediaBase, /kNativeMediaYoutubeMinContentDurationMinutes = 45U/);
  assert.match(mediaBase, /kNativeMediaYoutubeMaxContentDurationMinutes = 75U/);
  assert.match(mediaBase, /const UINT youtubeMinuteSpan =[\s\S]*YoutubeMaxContentDurationMinutes -[\s\S]*YoutubeMinContentDurationMinutes \+ 1U/);
  assert.match(mediaBase, /NativeMediaXRandomBelow\(youtubeMinuteSpan\)/);
  assert.match(mediaBase, /plan\.youtubeContentDurationMs = youtubeMinutes \* 60U \* 1000U/);
  assert.match(mediaBase, /UINT NativeMediaCurrentYoutubeContentDurationMs\(\) noexcept/);
  assert.match(mediaBase, /const UINT youtubeContentDurationMs = NativeMediaCurrentYoutubeContentDurationMs\(\)/);
  assert.match(mediaBase, /kNativeMediaXPhaseMs = 2U \* 60U \* 1000U/);
  assert.match(xRuntime, /const deadline = performance\.now\(\) \+ 120 \* 1000/);
  assert.doesNotMatch(youtubePolicy, /media_youtube_x_transition/);
  assert.match(host, /ArmTimer\(kNativeMediaXStartTimer, xRemaining\)/);
  assert.match(host, /Navigate\(L"https:\/\/x\.com\/home"\)/);
});

test('TVer keeps its 45-75 minute playback phase uninterrupted by X', () => {
  assert.match(mediaBase, /kNativeMediaTverMinContentDurationMinutes = 45U/);
  assert.match(mediaBase, /kNativeMediaTverMaxContentDurationMinutes = 75U/);
  assert.match(mediaBase, /const UINT tverMinuteSpan =[\s\S]*TverMaxContentDurationMinutes -[\s\S]*TverMinContentDurationMinutes \+ 1U/);
  assert.match(mediaBase, /NativeMediaXRandomBelow\(tverMinuteSpan\)/);
  assert.match(mediaBase, /plan\.tverContentDurationMs = tverMinutes \* 60U \* 1000U/);
  assert.match(mediaBase, /UINT NativeMediaCurrentTverContentDurationMs\(\) noexcept/);
  assert.match(mediaBase, /TVer owns this WebView continuously/);
  assert.match(mediaBase, /return NativeMediaCurrentTverContentDurationMs\(\) \+ 1000U/);
  assert.match(
    mediaBase,
    /if \(tver\) \{[\s\S]*return NativeMediaCurrentTverContentDurationMs\(\);/,
  );
  assert.doesNotMatch(tverRuntime, /homepanel:tver-x-phase-start/);
  assert.match(host, /phase_ == Phase::Tver[\s\S]*kNativeMediaTverContentDurationMs/);
});

test('a TVer X timer is placed after the phase boundary so it cannot navigate TVer away', () => {
  assert.match(mediaBase, /TVer owns this WebView continuously/);
  assert.match(mediaBase, /return NativeMediaCurrentTverContentDurationMs\(\) \+ 1000U/);
  assert.match(host, /if \(!phaseStarted_ \|\| GetTickCount64\(\) - phaseStartedAt_ < contentMs\) return true/);
  assert.match(mediaBase, /Entering YouTube is the safe boundary for the first X slot/);
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
  assert.match(xRuntime, /const likeWaitChoicesMs = \[5 \* 1000, 10 \* 1000, 15 \* 1000, 20 \* 1000\]/);
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

test('X scrolling is twice the previous targeted speed', () => {
  assert.match(xRuntime, /const maxScrollStepPx = 56/);
  assert.match(xRuntime, /const minScrollStepPx = 20/);
  assert.match(xRuntime, /Math\.ceil\(Math\.abs\(distance\) \* 0\.70\)/);
  assert.match(xRuntime, /state\.result = 'approaching-like'/);
  assert.match(xRuntime, /window\.scrollBy\(\{ top: Math\.sign\(distance\) \* step, behavior: 'smooth' \}\)/);
});

test('X timeline CSS only hides classified repost/promotion rows and placement ads', () => {
  assert.match(xRuntime, /homepanel-x-timeline-filter/);
  assert.match(xRuntime, /data-homepanel-x-filtered/);
  assert.match(xRuntime, /article\[data-testid="tweet"\]:has\(\[data-testid\*="placement" i\]\)/);
  assert.match(xRuntime, /display:\s*none !important/);
  assert.match(xRuntime, /markFilteredArticles\(\)/);
  assert.doesNotMatch(xRuntime, /article\[data-testid="tweet"\]:has\(\[data-testid="socialContext"\]\)/);
  assert.doesNotMatch(xRuntime, /cellInnerDiv[^`]*socialContext/);
  assert.doesNotMatch(xRuntime, /const promotedText/);
  assert.match(xRuntime, /!element\.closest\?\.\('\[data-testid="tweetText"\]'\)/);
});
