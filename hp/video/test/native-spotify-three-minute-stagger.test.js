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
const ended = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url),
  'utf8',
);

test('Spotify fallback startup staggering keeps the 40-second six-account clock', () => {
  assert.match(wrapper, /#include "spotify_stagger_timer\.inc"/);
  assert.match(wrapper, /#include "spotify_timed_end_rotation\.inc"/);
  assert.match(timer, /kSpotifySerializedSlotStepMs = 40U \* 1000U/);
  assert.match(timer, /StaggeredReconcileTimerProc/);
  assert.match(schedule, /kSpotifyTimedSlotOffsetMs = 40ULL \* 1000ULL/);
  assert.match(
    schedule,
    /elapsed \/ kSpotifyTimedSlotOffsetMs\) % slots_\.size\(\)/,
  );
});

test('YouTube hour keeps BitterBlue and TALKABOUT prelude then starts A at minute 20', () => {
  assert.match(header, /youtubeCycleStartTick_ = 0/);
  assert.match(
    header,
    /TimedSpotifyTarget[\s\S]*BitterBlue[\s\S]*TalkAbout[\s\S]*LonesomeRabbit[\s\S]*CatalogTrack/,
  );
  assert.match(schedule, /kSpotifyTimedTalkAboutStartMs = 4ULL \* 60ULL \* 1000ULL/);
  assert.match(schedule, /kSpotifyTimedRotationStartMs = 20ULL \* 60ULL \* 1000ULL/);
  assert.match(schedule, /InitializeTimedRotationSlot\(slot, now\)/);
  assert.match(ended, /timedRotationPosition = 0/);
  assert.match(ended, /case 0:[\s\S]*LonesomeRabbit/);
  assert.match(ended, /case 1:[\s\S]*BitterBlue/);
  assert.match(ended, /case 2:[\s\S]*timedRandomCIndex/);
  assert.match(ended, /default:[\s\S]*timedRandomDIndex/);
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

test('Spotify ads are waited through before the next sequence track is opened', () => {
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

test('C and D remain a distinct random pair for each completed A-B-C-D cycle', () => {
  assert.match(header, /timedRandomPairCycle_ = ~0ULL/);
  assert.match(header, /timedRandomCIndex = kNoTimedCatalogIndex/);
  assert.match(header, /timedRandomDIndex = kNoTimedCatalogIndex/);
  assert.match(timed, /void SpotifyWebViews::EnsureTimedRandomPair\(ULONGLONG rotationCycle\) noexcept/);
  assert.match(timed, /timedRandomCIndex_ = PickTimedRandomCatalogIndex\(kNoTimedCatalogIndex\)/);
  assert.match(timed, /timedRandomDIndex_ = PickTimedRandomCatalogIndex\(timedRandomCIndex_\)/);
  assert.match(ended, /\+\+slot\.timedRotationCycle/);
  assert.match(ended, /EnsureTimedRandomPair\(slot\.timedRotationCycle\)/);
  assert.match(ended, /slot\.timedRandomCIndex = timedRandomCIndex_/);
  assert.match(ended, /slot\.timedRandomDIndex = timedRandomDIndex_/);
});

test('built-in random catalog contains verified Spotify track URLs and excludes fixed A/B', () => {
  assert.match(timed, /std::array<SpotifyTimedCatalogTrack, 20>/);
  for (const id of [
    '4ljk3qMzdU81kWzxcNix3F',
    '6ujztecmohAyiBzd21jKZF',
    '55owiSiQaWM2YHedWobsmd',
    '3kAccmfdpknDrdDNgEfWi3',
    '65qUpiboIWUHS2xilfsS5d',
    '5NAhakYBfDrnPwclaAqKQT',
    '2ze5Hu3eRRe6HxJTfuZaA0',
    '49cxVtrML7Xo63UFaaJrUR',
    '6JlqZHeCFdV6cl9DtSZhR2',
    '4IfRFec7SNKOWw1HzpiqHQ',
    '6GF0ZgT8wlksWrlLTfGmlU',
    '44sj7vChwZRYQ0Oz9AFyP2',
    '563WCw6gfsUCKlLTGYU4p4',
    '7mOPqaJicc6WdPCZqumP4e',
    '34CdKBveafYqBSzDDmUwRI',
    '78ancRAao1sxvMTv1E3hs3',
    '31vLfN5bNOpasgULiqSbLx',
    '3Ule6qlH6klo2T3y1Zlgtt',
    '307SI8AgVvBbNTkNrETKHW',
    '0lIgXSxKgRUjF0SiN19MmJ',
  ]) {
    assert.match(timed, new RegExp(id));
  }
  const catalogSection = timed.slice(
    timed.indexOf('kSpotifyRandomCatalogTracks'),
    timed.indexOf('static_assert'),
  );
  assert.doesNotMatch(catalogSection, /5EjWZuODqEPQ9eq7XCmITh/);
  assert.doesNotMatch(catalogSection, /2f2Ik9JeinFVWZuFb3i35b/);
});

test('a just-finished song gets temporary recovery priority so the next target can start promptly', () => {
  assert.match(header, /timedPrioritySlotIndex_ = kAccountCount/);
  assert.match(header, /timedPriorityUntilTick_ = 0/);
  assert.match(ended, /kSpotifyTimedPriorityHoldMs = 40ULL \* 1000ULL/);
  assert.match(ended, /timedPrioritySlotIndex_ = slot\.index/);
  assert.match(schedule, /now < timedPriorityUntilTick_[\s\S]*scheduledIndex = timedPrioritySlotIndex_/);
});

test('timed playback still owns autoplay and does not use repeat-one', () => {
  assert.match(wrapper, /RewriteSpotifyLegacyAutoplayScript/);
  assert.match(wrapper, /#include "spotify_timed_sequence\.inc"/);
  assert.match(timed, /5EjWZuODqEPQ9eq7XCmITh/);
  assert.match(timed, /2ZQy2mlwQodabAILwZ02Ed/);
  assert.match(timed, /2f2Ik9JeinFVWZuFb3i35b/);
  assert.doesNotMatch(timed, /ensureRepeatOne|repeatState|control-button-repeat/);
});

test('TALKABOUT remains one-shot and can return to Lonesome before minute 20', () => {
  assert.match(timed, /const playbackRate = 3\.0/);
  assert.match(timed, /__homePanelSpotifyTimedPodcastOneShot/);
  assert.match(timed, /media\.addEventListener\('ended'/);
  assert.match(timed, /return 'completed'/);
  assert.match(
    timed,
    /requestedTarget == TimedSpotifyTarget::TalkAbout[\s\S]*podcastCompleted = true[\s\S]*timedTarget = TimedSpotifyTarget::LonesomeRabbit[\s\S]*NavigateTimedSlot\(\*target\)/,
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
