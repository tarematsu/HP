import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/spotify_webviews.inc', import.meta.url), 'utf8');
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url), 'utf8');
const schedule = readFileSync(
  new URL('../../native/src/spotify_stagger_schedule.inc', import.meta.url), 'utf8');
const timed = readFileSync(
  new URL('../../native/src/spotify_timed_sequence.inc', import.meta.url), 'utf8');
const recent = readFileSync(
  new URL('../../native/src/spotify_recent_catalog.inc', import.meta.url), 'utf8');
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url), 'utf8');
const scripts = readFileSync(
  new URL('../../native/src/spotify_static_scripts.inc', import.meta.url), 'utf8');
const scoped = readFileSync(
  new URL('../../native/src/spotify_scoped_track_reconcile.inc', import.meta.url), 'utf8');
const runtime = readFileSync(
  new URL('../../native/src/spotify_media_observer_runtime.inc', import.meta.url), 'utf8');
const events = readFileSync(
  new URL('../../native/src/spotify_media_observer_events.inc', import.meta.url), 'utf8');

test('Spotify startup keeps 40-second account offsets with one direct scheduler', () => {
  assert.match(wrapper, /#include "spotify_stagger_schedule\.inc"/);
  assert.doesNotMatch(wrapper, /spotify_stagger_timer\.inc|#define SetTimer/);
  assert.match(schedule, /kSpotifyTimedSlotOffsetMs = 40ULL \* 1000ULL/);
  assert.match(schedule, /static_cast<ULONGLONG>\(accountCount\) \* kSpotifyTimedSlotOffsetMs/);
  assert.match(schedule, /SimpleSpotifyScheduledIndex\(elapsed, slots_\.size\(\)\)/);
  assert.doesNotMatch(schedule, /% 6ULL|std::min<ULONGLONG>\(5ULL/);
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

test('A-B-C-D advances immediately on ended or no later than four minutes after target selection', () => {
  assert.match(rotation, /case 0:[\s\S]*LonesomeRabbit[\s\S]*break;/);
  assert.match(rotation, /case 1:[\s\S]*CatalogTrack[\s\S]*timedRandomCIndex/);
  assert.match(rotation, /case 2:[\s\S]*BitterBlue[\s\S]*break;/);
  assert.match(rotation, /default:[\s\S]*CatalogTrack[\s\S]*timedRandomDIndex/);
  assert.match(events, /document\.addEventListener\('ended'/);
  assert.match(events, /spotify:timed-ended/);
  assert.match(rotation, /AdvanceTimedRotationSlot\(\*target, now\)/);
  assert.match(rotation, /timedRotationPosition \+ 1U/);
  assert.match(header, /timedPlaybackStartTick = 0/);
  assert.match(rotation, /kSpotifyTimedTrackDeadlineMs = 4ULL \* 60ULL \* 1000ULL/);
  assert.match(runtime, /spotify:timed-started/);
  assert.match(runtime, /navigator\.mediaSession/);
  assert.match(runtime, /matchesTarget\(target, currentTrack\(\)\)/);
  assert.match(runtime, /\[0, 250, 1000, 2500, 5000\]/);
  assert.match(
    rotation,
    /ApplyTimedRotationTarget\(Slot& slot\)[\s\S]*timedPlaybackStartTick = GetTickCount64\(\)/,
  );
  assert.match(rotation, /bool SpotifyWebViews::AdvanceExpiredTimedRotation/);
  assert.match(rotation, /now - slot\.timedPlaybackStartTick < kSpotifyTimedTrackDeadlineMs/);
  assert.match(schedule, /AdvanceExpiredTimedRotation\(now\)/);
  assert.doesNotMatch(rotation, /timedPlaybackStartTick == 0[\s\S]*timedPlaybackStartTick = now/);
  assert.doesNotMatch(schedule, /kSpotifyTimedWaveMs|rotationWave/);
});

test('stale playback events are rejected by target generation', () => {
  assert.match(header, /ULONGLONG targetGeneration = 0/);
  assert.match(rotation, /ParseSpotifyGenerationEvent/);
  assert.match(rotation, /eventGeneration != target->targetGeneration/);
  assert.match(recent, /spotify:generation/);
  assert.match(recent, /std::to_wstring\(slot\.targetGeneration\)/);
  assert.match(runtime, /message \+ '\\u001f' \+ generation\(\)/);
});

test('slow navigation re-arms observers on owner-only recovery attempts', () => {
  assert.match(
    schedule,
    /slot\.lastTimedReconcileTick = now;[\s\S]*ArmTimedEndObserver\(slot\);[\s\S]*ReconcileActiveTimedSlot\(slot\)/,
  );
  assert.match(schedule, /slot\.timedTarget != TimedSpotifyTarget::TalkAbout/);
});

test('bridge is a one-shot recent song before the formal rotation', () => {
  assert.match(schedule, /!slot\.timedBridgeCompleted[\s\S]*PickRecentCatalogIndex/);
  assert.match(rotation, /IsRecentCatalogIndex\(target->timedCatalogIndex\)[\s\S]*timedBridgeCompleted = true/);
  assert.match(rotation, /StopTimedOneShotPlayback\(\*target\)/);
  assert.match(rotation, /kSpotifyStaticStopPlaybackScript/);
});

test('ads neither start nor complete the requested track and legacy ambiguity state is gone', () => {
  assert.match(runtime, /!matchesTarget\(target, currentTrack\(\)\)/);
  assert.match(events, /!state\.started \|\| state\.endedPosted/);
  assert.doesNotMatch(runtime + events, /spotify:timed-waiting|waitForNext/);
  assert.doesNotMatch(rotation, /kSpotifySimplePendingRecoveryMs|timedCompletionPendingTick/);
  assert.doesNotMatch(schedule, /timedCompletionPendingTick/);
  assert.doesNotMatch(header, /timedCompletionPendingTick/);
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

test('recent catalog is one direct-track table passed to the scoped reconcile script', () => {
  for (const id of [
    '7vvZ1QHTdkoEXBiOBdxdIo', '6O3XAkrjMG1T4x8jvdpbrp',
    '49cxVtrML7Xo63UFaaJrUR', '33liCluqUasE65nMv3KLLm',
  ]) assert.match(recent, new RegExp(id));
  assert.doesNotMatch(recent, /spotify_recent_direct_routes\.inc|RecentTimedCatalogDirectRoute/);
  assert.match(recent, /PostSpotifyTargetDescriptorForSlot\(slot\)/);
  assert.match(recent, /kSpotifyStaticTrackReconcileScript/);
  assert.match(scoped, /targetLink/);
  assert.match(scoped, /scrollIntoView/);
  assert.doesNotMatch(recent, /BuildRecentTrackScript|EscapeRecentScriptLiteral/);
});

test('timed playback opens fixed songs by direct track URL without script rewriting', () => {
  assert.match(wrapper, /#include "spotify_static_scripts\.inc"/);
  assert.match(wrapper, /#include "spotify_scoped_track_reconcile\.inc"/);
  assert.match(wrapper, /#include "spotify_timed_sequence\.inc"/);
  assert.match(wrapper, /#include "spotify_recent_catalog\.inc"/);
  assert.match(timed, /5EjWZuODqEPQ9eq7XCmITh/);
  assert.match(timed, /2ZQy2mlwQodabAILwZ02Ed/);
  assert.match(timed, /6Vy6hCA2CZwZalGqaX6Sew/);
  assert.match(timed, /kSpotifyLonesomeRabbitUrl[\s\S]*open\.spotify\.com\/track\/6Vy6hCA2CZwZalGqaX6Sew/);
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