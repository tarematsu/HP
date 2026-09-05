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

test('Spotify fallback startup staggering matches the 40-second six-account clock', () => {
  assert.match(wrapper, /#include "spotify_stagger_timer\.inc"/);
  assert.match(wrapper, /#define SetTimer\(hwnd, timerId, interval, callback\)/);
  assert.match(timer, /kSpotifySerializedSlotStepMs = 40U \* 1000U/);
  assert.match(timer, /StaggeredReconcileTimerProc/);
  assert.match(schedule, /kSpotifyTimedSlotOffsetMs = 40ULL \* 1000ULL/);
  assert.match(
    schedule,
    /elapsed \/ kSpotifyTimedSlotOffsetMs\) % slots_\.size\(\)/,
  );
});

test('YouTube hour keeps BitterBlue and TALKABOUT prelude then starts A-B-C-D at minute 20', () => {
  assert.match(header, /youtubeCycleStartTick_ = 0/);
  assert.match(
    header,
    /TimedSpotifyTarget[\s\S]*BitterBlue[\s\S]*TalkAbout[\s\S]*LonesomeRabbit[\s\S]*CatalogTrack/,
  );
  assert.match(schedule, /kSpotifyTimedWaveMs = 4ULL \* 60ULL \* 1000ULL/);
  assert.match(schedule, /kSpotifyTimedTalkAboutStartMs = 4ULL \* 60ULL \* 1000ULL/);
  assert.match(schedule, /kSpotifyTimedRotationStartMs = 20ULL \* 60ULL \* 1000ULL/);
  assert.match(schedule, /slotLocalElapsed < kSpotifyTimedTalkAboutStartMs[\s\S]*TimedSpotifyTarget::BitterBlue/);
  assert.match(schedule, /slotLocalElapsed < kSpotifyTimedRotationStartMs[\s\S]*TimedSpotifyTarget::TalkAbout/);
  assert.match(schedule, /const unsigned position = static_cast<unsigned>\(rotationWave % 4ULL\)/);
  assert.match(schedule, /case 0:[\s\S]*LonesomeRabbit/);
  assert.match(schedule, /case 1:[\s\S]*BitterBlue/);
  assert.match(schedule, /case 2:[\s\S]*CatalogTrack[\s\S]*timedRandomCIndex_/);
  assert.match(schedule, /default:[\s\S]*CatalogTrack[\s\S]*timedRandomDIndex_/);
});

test('C and D are redrawn as a distinct pair once per 16-minute rotation cycle', () => {
  assert.match(header, /timedRandomPairCycle_ = ~0ULL/);
  assert.match(header, /timedRandomCIndex_ = kNoTimedCatalogIndex/);
  assert.match(header, /timedRandomDIndex_ = kNoTimedCatalogIndex/);
  assert.match(timed, /void SpotifyWebViews::EnsureTimedRandomPair\(ULONGLONG rotationCycle\) noexcept/);
  assert.match(timed, /timedRandomCIndex_ = PickTimedRandomCatalogIndex\(kNoTimedCatalogIndex\)/);
  assert.match(timed, /timedRandomDIndex_ = PickTimedRandomCatalogIndex\(timedRandomCIndex_\)/);
  assert.match(timed, /timedRandomCIndex_ != timedRandomDIndex_/);
  assert.match(schedule, /const ULONGLONG rotationCycle = rotationWave \/ 4ULL/);
  assert.match(schedule, /EnsureTimedRandomPair\(rotationCycle\)/);
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

test('every four-minute wave performs a fresh Spotify access and direct tracks use exact-path playback checks', () => {
  assert.match(schedule, /rotationWaveChanged/);
  assert.match(schedule, /slot\.lastTimedRotationWave = rotationWave[\s\S]*NavigateTimedSlot\(slot\)/);
  assert.match(timed, /kSpotifyTimedTrackScriptTemplate/);
  assert.match(timed, /const targetPath = '__TARGET_PATH__'/);
  assert.match(timed, /new URL\(link\.href, location\.href\)\.pathname === targetPath/);
  assert.match(timed, /BuildTimedTrackScript\(track->path\)/);
  assert.match(timed, /slot\.webview->Navigate\(url\)/);
});

test('timed playback owns autoplay and does not use repeat-one', () => {
  assert.match(wrapper, /RewriteSpotifyLegacyAutoplayScript/);
  assert.match(wrapper, /#include "spotify_timed_sequence\.inc"/);
  assert.match(timed, /5EjWZuODqEPQ9eq7XCmITh/);
  assert.match(timed, /2ZQy2mlwQodabAILwZ02Ed/);
  assert.match(timed, /2f2Ik9JeinFVWZuFb3i35b/);
  assert.doesNotMatch(timed, /ensureRepeatOne|repeatState|control-button-repeat/);
});

test('TALKABOUT remains one-shot and returns to Lonesome before the minute-20 rotation if it finishes early', () => {
  assert.match(timed, /const playbackRate = 3\.0/);
  assert.match(timed, /__homePanelSpotifyTimedPodcastOneShot/);
  assert.match(timed, /media\.addEventListener\('ended'/);
  assert.match(timed, /return 'completed'/);
  assert.match(
    timed,
    /requestedTarget == TimedSpotifyTarget::TalkAbout[\s\S]*podcastCompleted = true[\s\S]*timedTarget = TimedSpotifyTarget::LonesomeRabbit[\s\S]*NavigateTimedSlot\(\*target\)/,
  );
  assert.match(schedule, /rotationWave != ~0ULL && slot\.lastTimedRotationWave != rotationWave/);
});

test('TVer keeps the same A-B-C-D master clock and does not navigate all six slots together', () => {
  assert.match(wrapper, /#define SetPodcastMode SetPodcastModeImmediate/);
  assert.match(schedule, /TVer does not reset the YouTube master clock/);
  assert.doesNotMatch(
    schedule,
    /for \(Slot& slot : slots_\) \{[\s\S]*slot\.webview->Navigate/,
  );
});
