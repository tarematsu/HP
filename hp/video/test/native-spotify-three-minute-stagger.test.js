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
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url),
  'utf8',
);

test('Spotify startup keeps the original 40-second six-account offsets', () => {
  assert.match(wrapper, /#include "spotify_stagger_timer\.inc"/);
  assert.match(wrapper, /#include "spotify_timed_end_rotation\.inc"/);
  assert.match(wrapper, /#include "spotify_stagger_schedule\.inc"/);
  assert.match(timer, /kSpotifySerializedSlotStepMs = 40U \* 1000U/);
  assert.match(timer, /StaggeredReconcileTimerProc/);
  assert.match(schedule, /kSpotifyTimedSlotOffsetMs = 40ULL \* 1000ULL/);
  assert.match(schedule, /kSpotifyInitialSerialWindowMs = 6ULL \* 40ULL \* 1000ULL/);
});

test('YouTube hour keeps BitterBlue and TALKABOUT, recent bridge, then starts A at minute 20', () => {
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
});

test('A-B-C-D target order is unchanged and advances only from completion', () => {
  assert.match(rotation, /timedRotationPosition = 0/);
  assert.match(rotation, /case 0:[\s\S]*LonesomeRabbit[\s\S]*break;/);
  assert.match(
    rotation,
    /case 1:[\s\S]*TimedSpotifyTarget::CatalogTrack[\s\S]*timedRandomCIndex[\s\S]*break;/,
  );
  assert.match(rotation, /case 2:[\s\S]*TimedSpotifyTarget::BitterBlue[\s\S]*break;/);
  assert.match(
    rotation,
    /default:[\s\S]*TimedSpotifyTarget::CatalogTrack[\s\S]*timedRandomDIndex[\s\S]*break;/,
  );
  assert.match(rotation, /media\.addEventListener\('ended'/);
  assert.match(rotation, /spotify:timed-ended/);
  assert.match(rotation, /AdvanceTimedRotationSlot\(\*target, now\)/);
  assert.match(rotation, /timedRotationPosition \+ 1U/);
  assert.doesNotMatch(schedule, /kSpotifyTimedWaveMs|rotationWave/);
});

test('bridge is a one-shot recent song before formal minute-20 rotation', () => {
  assert.match(
    schedule,
    /!slot\.timedBridgeCompleted[\s\S]*PickRecentCatalogIndex[\s\S]*desired = TimedSpotifyTarget::CatalogTrack/,
  );
  assert.match(
    rotation,
    /TimedSpotifyTarget::CatalogTrack[\s\S]*IsRecentCatalogIndex\(target->timedCatalogIndex\)[\s\S]*timedBridgeCompleted = true/,
  );
  assert.match(rotation, /StopTimedOneShotPlayback\(\*target\)/);
});

test('ads are waited through without a permanent polling loop', () => {
  assert.match(rotation, /spotify:timed-waiting/);
  assert.match(rotation, /state\.waitForNext/);
  assert.match(rotation, /setTimeout\(state\.waitForNext, 2500\)/);
  assert.doesNotMatch(rotation, /setInterval\(/);
  assert.match(schedule, /timedCompletionPendingTick != 0/);
});

test('three-minute ambiguity timeout retries the same target instead of skipping a song', () => {
  assert.match(rotation, /kSpotifySimplePendingRecoveryMs = 3ULL \* 60ULL \* 1000ULL/);
  assert.match(schedule, /now - slot\.timedCompletionPendingTick < kSpotifySimplePendingRecoveryMs/);
  assert.match(schedule, /slot\.timedCompletionPendingTick = 0/);
  assert.match(schedule, /slot\.lastTimedReconcileTick = 0/);
  assert.doesNotMatch(
    schedule,
    /timedCompletionPendingTick[\s\S]*AdvanceTimedRotationSlot/,
  );
});

test('finished target keeps the same slot briefly for simple next-track recovery', () => {
  assert.match(rotation, /staggerSlotIndex_ = slot\.index/);
  assert.match(rotation, /staggerSlotStartTick_ = now/);
  assert.match(rotation, /staggerSlotValidated_ = false/);
  assert.match(schedule, /kSpotifySimpleRecoveryHoldMs = 12ULL \* 1000ULL/);
  assert.match(schedule, /const bool holdRecovery/);
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
  assert.match(rotation, /EnsureRecentRandomPair\(slot\.timedRotationCycle, timedBridgeCatalogIndex_\)/);
  assert.doesNotMatch(rotation, /EnsureTimedRandomPair\(/);
});

test('recent random pool contains every 2025-2026 new group song except fixed A/C', () => {
  assert.match(recent, /std::array<SpotifyRecentCatalogTrack, 35>/);
  const expectedTitles = [
    'UDAGAWA GENERATION', 'Nightmare症候群', 'Nothing special',
    '紋白蝶が確か飛んでた', '行かないで', 'ULTRAVIOLET', 'やるしかないじゃん',
    'Addiction', 'Make or Break', '死んだふり', '港区パセリ', '恋愛無双',
    '真夏の大統領', '君のことを想いながら', 'ノンアルコール',
    'Unhappy birthday構文', 'Alter ego', '木枯らしは泣かない',
    '青空が見えるまで', 'I will be', 'Buddies (English Version)',
    '夜空で一番輝いてる星の名前を僕は知らない', 'The growing up train',
    '光源', 'ドライフルーツ', 'キスが苦い', 'くらげらしく', 'Sunny side up',
    '僕は向いてない', 'What\'s \\"KAZOKU\\"?', 'コインランドリー',
    'We got your back', '狼たちよ', '各駅停車', '恵まれ過ぎて',
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

test('timed playback owns autoplay and does not use repeat-one', () => {
  assert.match(wrapper, /RewriteSpotifyLegacyAutoplayScript/);
  assert.match(wrapper, /#include "spotify_timed_sequence\.inc"/);
  assert.match(wrapper, /#include "spotify_recent_catalog\.inc"/);
  assert.match(timed, /5EjWZuODqEPQ9eq7XCmITh/);
  assert.match(timed, /2ZQy2mlwQodabAILwZ02Ed/);
  assert.match(timed, /2f2Ik9JeinFVWZuFb3i35b/);
  assert.doesNotMatch(timed, /ensureRepeatOne|repeatState|control-button-repeat/);
});

test('TALKABOUT remains one-shot and scheduler hands it to the recent bridge', () => {
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
  assert.match(schedule, /TVer leaves the current completion-driven rotation untouched/);
  assert.doesNotMatch(
    schedule,
    /for \(Slot& slot : slots_\) \{[\s\S]*slot\.webview->Navigate/,
  );
});
