import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/spotify_webviews.inc', import.meta.url),
  'utf8',
);
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url),
  'utf8',
);
const schedule = readFileSync(
  new URL('../../native/src/spotify_stagger_schedule.inc', import.meta.url),
  'utf8',
);
const timed = readFileSync(
  new URL('../../native/src/spotify_timed_sequence.inc', import.meta.url),
  'utf8',
);
const recent = readFileSync(
  new URL('../../native/src/spotify_recent_catalog.inc', import.meta.url),
  'utf8',
);
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url),
  'utf8',
);
const scripts = readFileSync(
  new URL('../../native/src/spotify_static_scripts.inc', import.meta.url),
  'utf8',
);

test('Spotify startup keeps 40-second six-account offsets with one direct scheduler', () => {
  assert.match(wrapper, /#include "spotify_stagger_schedule\.inc"/);
  assert.doesNotMatch(wrapper, /spotify_stagger_timer\.inc|#define SetTimer/);
  assert.match(schedule, /kSpotifyTimedSlotOffsetMs = 40ULL \* 1000ULL/);
  assert.match(schedule, /kSpotifyInitialSerialWindowMs = 6ULL \* 40ULL \* 1000ULL/);
  assert.match(schedule, /StaggeredReconcileTimerProc/);
});

test('YouTube hour keeps BitterBlue and TALKABOUT, recent bridge, then starts rotation at minute 20', () => {
  assert.match(header, /youtubeCycleStartTick_ = 0/);
  assert.match(header, /timedBridgeCatalogIndex_ = kNoTimedCatalogIndex/);
  assert.match(header, /timedBridgeCompleted = false/);
  assert.match(schedule, /kSpotifyTimedTalkAboutStartMs = 4ULL \* 60ULL \* 1000ULL/);
  assert.match(schedule, /kSpotifyTimedRotationStartMs = 20ULL \* 60ULL \* 1000ULL/);
  assert.match(schedule, /!slot\.podcastCompleted[\s\S]*TimedSpotifyTarget::TalkAbout/);
  assert.match(schedule, /!slot\.timedBridgeCompleted[\s\S]*PickRecentCatalogIndex/);
  assert.match(schedule, /InitializeTimedRotationSlot\(slot, now\)/);
});

test('A-B-C-D advances immediately on ended or after four minutes of actual track playback', () => {
  assert.match(rotation, /case 0:[\s\S]*LonesomeRabbit[\s\S]*break;/);
  assert.match(rotation, /case 1:[\s\S]*CatalogTrack[\s\S]*timedRandomCIndex/);
  assert.match(rotation, /case 2:[\s\S]*BitterBlue[\s\S]*break;/);
  assert.match(rotation, /default:[\s\S]*CatalogTrack[\s\S]*timedRandomDIndex/);
  assert.match(scripts, /media\.addEventListener\('ended'/);
  assert.match(scripts, /spotify:timed-ended/);
  assert.match(rotation, /AdvanceTimedRotationSlot\(\*target, now\)/);
  assert.match(rotation, /timedRotationPosition \+ 1U/);

  assert.match(header, /timedPlaybackStartTick = 0/);
  assert.match(rotation, /kSpotifyTimedTrackDeadlineMs = 4ULL \* 60ULL \* 1000ULL/);
  assert.match(rotation, /spotify:timed-started/);
  assert.match(rotation, /target\.trackPath[\s\S]*track\.path === target\.trackPath/);
  assert.match(rotation, /normalize\(metadata && metadata\.title\) === target\.title/);
  assert.match(
    rotation,
    /timedPlaybackStartTick == 0[\s\S]*timedPlaybackStartTick = now/,
  );
  assert.match(rotation, /bool SpotifyWebViews::AdvanceExpiredTimedRotation/);
  assert.match(
    rotation,
    /now - slot\.timedPlaybackStartTick < kSpotifyTimedTrackDeadlineMs/,
  );
  assert.match(schedule, /AdvanceExpiredTimedRotation\(now\)/);
  assert.doesNotMatch(rotation, /setInterval\(/);
  assert.doesNotMatch(schedule, /kSpotifyTimedWaveMs|rotationWave/);
});

test('stale ended is blocked only during new-target navigation, then valid ended remains a fallback', () => {
  assert.match(
    rotation,
    /timedRotationActive &&[\s\S]*timedPlaybackStartTick == 0 &&[\s\S]*lastModeNavigateTick != 0[\s\S]*return S_OK/,
  );
  assert.match(rotation, /lastModeNavigateTick == 0/);
  assert.doesNotMatch(
    rotation,
    /timedRotationActive &&\s*target->timedPlaybackStartTick == 0\) \{\s*return S_OK/,
  );
});

test('bridge is a one-shot recent song before the formal rotation', () => {
  assert.match(schedule, /!slot\.timedBridgeCompleted[\s\S]*PickRecentCatalogIndex/);
  assert.match(rotation, /IsRecentCatalogIndex\(target->timedCatalogIndex\)[\s\S]*timedBridgeCompleted = true/);
  assert.match(rotation, /StopTimedOneShotPlayback\(\*target\)/);
  assert.match(rotation, /kSpotifyStaticStopPlaybackScript/);
});

test('ads are waited through without a permanent polling loop', () => {
  assert.match(scripts, /spotify:timed-waiting/);
  assert.match(scripts, /state\.waitForNext/);
  assert.match(scripts, /setTimeout\(state\.waitForNext, 2500\)/);
  assert.doesNotMatch(scripts, /setInterval\(/);
  assert.match(schedule, /timedCompletionPendingTick != 0/);
});

test('three-minute ambiguity timeout retries the same target instead of skipping', () => {
  assert.match(rotation, /kSpotifySimplePendingRecoveryMs = 3ULL \* 60ULL \* 1000ULL/);
  assert.match(schedule, /now - slot\.timedCompletionPendingTick < kSpotifySimplePendingRecoveryMs/);
  assert.match(schedule, /slot\.timedCompletionPendingTick = 0/);
  assert.match(schedule, /slot\.lastTimedReconcileTick = 0/);
  assert.doesNotMatch(schedule, /timedCompletionPendingTick[\s\S]*AdvanceTimedRotationSlot/);
});

test('B and D are distinct recent songs and avoid the current-hour bridge', () => {
  assert.match(header, /timedBridgeCatalogIndex_ = kNoTimedCatalogIndex/);
  assert.match(header, /timedRandomCIndex = kNoTimedCatalogIndex/);
  assert.match(header, /timedRandomDIndex = kNoTimedCatalogIndex/);
  assert.match(recent, /void SpotifyWebViews::EnsureRecentRandomPair/);
  assert.match(recent, /timedRandomCIndex_ != timedRandomDIndex_/);
  assert.match(recent, /timedRandomCIndex_ != avoidIndex/);
  assert.match(recent, /timedRandomDIndex_ != avoidIndex/);
  assert.match(rotation, /EnsureRecentRandomPair\(slot\.timedRotationCycle, timedBridgeCatalogIndex_\)/);
  assert.doesNotMatch(header, /PickTimedRandomCatalogIndex|EnsureTimedRandomPair/);
});

test('recent random pool retains the 35-song 2025-2026 catalog and excludes fixed A/C', () => {
  assert.match(recent, /std::array<SpotifyRecentCatalogTrack, 35>/);
  for (const title of [
    'UDAGAWA GENERATION', 'Nightmare症候群', 'Addiction', 'Make or Break',
    'Unhappy birthday構文', 'The growing up train', 'コインランドリー',
    'We got your back', '各駅停車', '恵まれ過ぎて',
  ]) {
    assert.ok(recent.includes(title), `missing recent Sakurazaka song: ${title}`);
  }
  const catalogSection = recent.slice(
    recent.indexOf('kSpotifyRecentCatalogTracks = {{'),
    recent.indexOf('static_assert(kSpotifyRecentCatalogTracks.size() == 35)'),
  );
  assert.doesNotMatch(catalogSection, /L"Lonesome rabbit"/);
  assert.doesNotMatch(catalogSection, /5EjWZuODqEPQ9eq7XCmITh/);
  assert.doesNotMatch(catalogSection, /愛MUST BE|OFF VOCAL|Interlude|Remix/);
});

test('recent catalog passes target data to one fixed reconcile script', () => {
  for (const id of [
    '3teo9NiJLwhorFf3EE9WCh', '19SC6o3wULkC8QIKV0YKIb',
    '5beJvSa1ZMvGtChLMkT60i', '04gmidhz5KYYOEqfTJXNmE',
  ]) assert.match(recent, new RegExp(id));
  assert.match(recent, /PostSpotifyTargetDescriptorForSlot\(slot\)/);
  assert.match(recent, /kSpotifyStaticTrackReconcileScript/);
  assert.match(scripts, /targetLink/);
  assert.match(scripts, /scrollIntoView/);
  assert.doesNotMatch(recent, /BuildRecentTrackScript|EscapeRecentScriptLiteral/);
});

test('timed playback is static and does not use repeat-one or runtime source rewriting', () => {
  assert.match(wrapper, /#include "spotify_static_scripts\.inc"/);
  assert.match(wrapper, /#include "spotify_timed_sequence\.inc"/);
  assert.match(wrapper, /#include "spotify_recent_catalog\.inc"/);
  assert.match(timed, /5EjWZuODqEPQ9eq7XCmITh/);
  assert.match(timed, /2ZQy2mlwQodabAILwZ02Ed/);
  assert.match(timed, /2f2Ik9JeinFVWZuFb3i35b/);
  assert.doesNotMatch(wrapper, /RewriteSpotify|#define ExecuteScript/);
  assert.doesNotMatch(timed, /BuildTimedTrackScript|ensureRepeatOne|control-button-repeat/);
});

test('TALKABOUT remains one-shot and scheduler hands completion to the recent bridge', () => {
  assert.match(scripts, /kSpotifyStaticPodcastReconcileScript/);
  assert.match(scripts, /const playbackRate = 3\.0/);
  assert.match(scripts, /__homePanelSpotifyPodcastOneShot/);
  assert.match(scripts, /media\.addEventListener\('ended'/);
  assert.match(scripts, /return 'completed'/);
  assert.match(timed, /requestedTarget == TimedSpotifyTarget::TalkAbout[\s\S]*podcastCompleted = true/);
  assert.match(schedule, /!slot\.podcastCompleted[\s\S]*TalkAbout[\s\S]*!slot\.timedBridgeCompleted/);
});

test('TVer keeps the same completion-driven rotation without a mode macro or mass navigation', () => {
  assert.doesNotMatch(wrapper, /#define SetPodcastMode/);
  assert.match(schedule, /TVer leaves the current completion-driven rotation untouched/);
  assert.doesNotMatch(schedule, /for \(Slot& slot : slots_\) \{[\s\S]*slot\.webview->Navigate/);
});
