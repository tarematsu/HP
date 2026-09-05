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
const timer = readFileSync(
  new URL('../../native/src/spotify_stagger_timer.inc', import.meta.url),
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
const ended = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url),
  'utf8',
);

test('Spotify fallback startup staggering keeps the 40-second six-account clock', () => {
  assert.match(wrapper, /#include "spotify_stagger_timer\.inc"/);
  assert.match(wrapper, /#include "spotify_recent_catalog\.inc"/);
  assert.match(wrapper, /#include "spotify_timed_end_rotation\.inc"/);
  assert.match(timer, /kSpotifySerializedSlotStepMs = 40U \* 1000U/);
  assert.match(timer, /StaggeredReconcileTimerProc/);
  assert.match(schedule, /kSpotifyTimedSlotOffsetMs = 40ULL \* 1000ULL/);
  assert.match(
    schedule,
    /elapsed \/ kSpotifyTimedSlotOffsetMs\) % slots_\.size\(\)/,
  );
});

test('YouTube hour keeps BitterBlue and TALKABOUT, uses a recent-song bridge, then starts A at minute 20', () => {
  assert.match(header, /youtubeCycleStartTick_ = 0/);
  assert.match(header, /timedBridgeCatalogIndex_ = kNoTimedCatalogIndex/);
  assert.match(header, /timedBridgeCompleted = false/);
  assert.match(schedule, /kSpotifyTimedTalkAboutStartMs = 4ULL \* 60ULL \* 1000ULL/);
  assert.match(schedule, /kSpotifyTimedRotationStartMs = 20ULL \* 60ULL \* 1000ULL/);
  assert.match(
    schedule,
    /!slot\.podcastCompleted[\s\S]*TimedSpotifyTarget::TalkAbout[\s\S]*!slot\.timedBridgeCompleted[\s\S]*PickRecentCatalogIndex[\s\S]*TimedSpotifyTarget::CatalogTrack/,
  );
  assert.match(schedule, /InitializeTimedRotationSlot\(slot, now\)/);
  assert.match(ended, /timedRotationPosition = 0/);
  assert.match(ended, /case 0:[\s\S]*LonesomeRabbit[\s\S]*break;/);
  assert.match(
    ended,
    /case 1:[\s\S]*TimedSpotifyTarget::CatalogTrack[\s\S]*timedRandomCIndex[\s\S]*break;/,
  );
  assert.match(ended, /case 2:[\s\S]*TimedSpotifyTarget::BitterBlue[\s\S]*break;/);
  assert.match(
    ended,
    /default:[\s\S]*TimedSpotifyTarget::CatalogTrack[\s\S]*timedRandomDIndex[\s\S]*break;/,
  );
});

test('bridge is a one-shot recent song and does not replay Lonesome before minute 20', () => {
  assert.match(schedule, /instead of falling back to Lonesome rabbit before the formal 20:00 A/);
  assert.match(schedule, /recentBridge[\s\S]*ArmTimedEndObserver\(slot\)/);
  assert.match(
    ended,
    /TimedSpotifyTarget::CatalogTrack[\s\S]*IsRecentCatalogIndex\(target->timedCatalogIndex\)[\s\S]*timedBridgeCompleted = true/,
  );
  assert.match(ended, /StopTimedOneShotPlayback\(\*target\)/);
  assert.match(schedule, /recentBridge && slot\.timedBridgeCompleted/);
});

test('A-B-C-D advances from actual track completion instead of fixed three-minute boundaries', () => {
  assert.doesNotMatch(schedule, /kSpotifyTimedWaveMs/);
  assert.doesNotMatch(schedule, /rotationWave = rotationElapsed/);
  assert.match(ended, /media\.addEventListener\('ended'/);
  assert.match(ended, /spotify:timed-waiting/);
  assert.match(ended, /spotify:timed-ended/);
  assert.match(ended, /AdvanceTimedRotationSlot\(\*target, now\)/);
  assert.match(ended, /timedRotationPosition \+ 1U/);
  assert.match(schedule, /ArmTimedEndObserver\(slot\)/);
});

test('Spotify ads are waited through before the next formal rotation track is opened', () => {
  assert.match(
    ended,
    /Ads do not expose another \/track\/ context[\s\S]*track\.path[\s\S]*spotify:timed-ended/,
  );
  assert.match(schedule, /timedCompletionPendingTick != 0\) return/);
  assert.match(schedule, /post-track\/ad waiting state/);
});

test('three minutes is only an unhealthy/waiting watchdog and does not cut healthy long songs', () => {
  assert.match(ended, /kSpotifyTimedFailureWatchdogMs = 3ULL \* 60ULL \* 1000ULL/);
  assert.match(schedule, /candidate\.timedCompletionPendingTick != 0/);
  assert.match(schedule, /else if \(candidate\.playing\)[\s\S]*timedUnhealthySinceTick = 0/);
  assert.match(
    schedule,
    /timedUnhealthySinceTick[\s\S]*kSpotifyTimedFailureWatchdogMs[\s\S]*AdvanceTimedRotationSlot/,
  );
});

test('B and D are distinct recent songs and avoid the current hour bridge', () => {
  assert.match(header, /timedBridgeCatalogIndex_ = kNoTimedCatalogIndex/);
  assert.match(header, /timedRandomCIndex = kNoTimedCatalogIndex/);
  assert.match(header, /timedRandomDIndex = kNoTimedCatalogIndex/);
  assert.match(
    recent,
    /void SpotifyWebViews::EnsureRecentRandomPair\([\s\S]*size_t avoidIndex\) noexcept/,
  );
  assert.match(recent, /timedRandomCIndex_ != timedRandomDIndex_/);
  assert.match(recent, /timedRandomCIndex_ != avoidIndex/);
  assert.match(recent, /timedRandomDIndex_ != avoidIndex/);
  assert.match(ended, /EnsureRecentRandomPair\(slot\.timedRotationCycle, timedBridgeCatalogIndex_\)/);
  assert.doesNotMatch(ended, /EnsureTimedRandomPair\(/);
});

test('recent random pool contains every 2025-2026 new group song except fixed A/C', () => {
  assert.match(recent, /std::array<SpotifyRecentCatalogTrack, 35>/);
  const expectedTitles = [
    'UDAGAWA GENERATION',
    'Nightmare症候群',
    'Nothing special',
    '紋白蝶が確か飛んでた',
    '行かないで',
    'ULTRAVIOLET',
    'やるしかないじゃん',
    'Addiction',
    'Make or Break',
    '死んだふり',
    '港区パセリ',
    '恋愛無双',
    '真夏の大統領',
    '君のことを想いながら',
    'ノンアルコール',
    'Unhappy birthday構文',
    'Alter ego',
    '木枯らしは泣かない',
    '青空が見えるまで',
    'I will be',
    'Buddies (English Version)',
    '夜空で一番輝いてる星の名前を僕は知らない',
    'The growing up train',
    '光源',
    'ドライフルーツ',
    'キスが苦い',
    'くらげらしく',
    'Sunny side up',
    '僕は向いてない',
    'What\'s \\"KAZOKU\\"?',
    'コインランドリー',
    'We got your back',
    '狼たちよ',
    '各駅停車',
    '恵まれ過ぎて',
  ];
  for (const title of expectedTitles) {
    assert.ok(recent.includes(title), `missing recent Sakurazaka song: ${title}`);
  }

  const catalogSection = recent.slice(
    recent.indexOf('kSpotifyRecentCatalogTracks = {{'),
    recent.indexOf('static_assert(kSpotifyRecentCatalogTracks.size() == 35)'),
  );
  assert.doesNotMatch(catalogSection, /L"Lonesome rabbit"/);
  assert.doesNotMatch(catalogSection, /5EjWZuODqEPQ9eq7XCmITh/);
  assert.doesNotMatch(catalogSection, /愛MUST BE/);
  assert.doesNotMatch(catalogSection, /OFF VOCAL|Interlude|Remix/);
});

test('recent catalog can open direct tracks or exact titled rows on verified album pages', () => {
  for (const id of [
    '3teo9NiJLwhorFf3EE9WCh',
    '19SC6o3wULkC8QIKV0YKIb',
    '5beJvSa1ZMvGtChLMkT60i',
    '04gmidhz5KYYOEqfTJXNmE',
  ]) {
    assert.match(recent, new RegExp(id));
  }
  assert.match(recent, /BuildRecentTrackScript/);
  assert.match(recent, /targetTitle/);
  assert.match(recent, /targetLink/);
  assert.match(recent, /scrollIntoView/);
  assert.match(recent, /NavigateRecentTimedSlot/);
  assert.match(recent, /ReconcileRecentTimedSlot/);
  assert.match(recent, /NavigateActiveTimedSlot/);
  assert.match(recent, /ReconcileActiveTimedSlot/);
});

test('a just-finished song gets temporary recovery priority so the next target can start promptly', () => {
  assert.match(header, /timedPrioritySlotIndex_ = kAccountCount/);
  assert.match(header, /timedPriorityUntilTick_ = 0/);
  assert.match(ended, /kSpotifyTimedPriorityHoldMs = 40ULL \* 1000ULL/);
  assert.match(ended, /timedPrioritySlotIndex_ = slot\.index/);
  assert.match(
    schedule,
    /priorityActive[\s\S]*staggerSlotIndex_ != timedPrioritySlotIndex_[\s\S]*staggerSlotIndex_ = timedPrioritySlotIndex_/,
  );
});

test('timed playback still owns autoplay and does not use repeat-one', () => {
  assert.match(wrapper, /RewriteSpotifyLegacyAutoplayScript/);
  assert.match(wrapper, /#include "spotify_timed_sequence\.inc"/);
  assert.match(wrapper, /#include "spotify_recent_catalog\.inc"/);
  assert.match(timed, /5EjWZuODqEPQ9eq7XCmITh/);
  assert.match(timed, /2ZQy2mlwQodabAILwZ02Ed/);
  assert.match(timed, /2f2Ik9JeinFVWZuFb3i35b/);
  assert.doesNotMatch(timed, /ensureRepeatOne|repeatState|control-button-repeat/);
});

test('TALKABOUT remains one-shot and the scheduler replaces its old handoff with the recent bridge', () => {
  assert.match(timed, /const playbackRate = 3\.0/);
  assert.match(timed, /__homePanelSpotifyTimedPodcastOneShot/);
  assert.match(timed, /media\.addEventListener\('ended'/);
  assert.match(timed, /return 'completed'/);
  assert.match(timed, /requestedTarget == TimedSpotifyTarget::TalkAbout[\s\S]*podcastCompleted = true/);
  assert.match(
    schedule,
    /!slot\.podcastCompleted[\s\S]*TalkAbout[\s\S]*!slot\.timedBridgeCompleted[\s\S]*PickRecentCatalogIndex/,
  );
});

test('TVer keeps the same completion-driven A-B-C-D sequence', () => {
  assert.match(wrapper, /#define SetPodcastMode SetPodcastModeImmediate/);
  assert.match(schedule, /TVer does not reset the YouTube master clock/);
  assert.doesNotMatch(
    schedule,
    /for \(Slot& slot : slots_\) \{[\s\S]*slot\.webview->Navigate/,
  );
});
