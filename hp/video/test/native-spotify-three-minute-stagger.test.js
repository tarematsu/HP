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
  assert.match(timer, /kSpotifyLegacyStartupTimerId = 1/);
  assert.match(timer, /kSpotifyLegacyModeSwitchTimerId = 3/);
  assert.match(timer, /StaggeredReconcileTimerProc/);
});

test('YouTube hour drives BitterBlue, TALKABOUT, then four-minute Lonesome waves', () => {
  assert.match(header, /youtubeCycleStartTick_ = 0/);
  assert.match(header, /TimedSpotifyTarget[\s\S]*BitterBlue[\s\S]*TalkAbout[\s\S]*LonesomeRabbit/);
  assert.match(schedule, /kSpotifyTimedSlotOffsetMs = 40ULL \* 1000ULL/);
  assert.match(schedule, /kSpotifyTimedWaveMs = 4ULL \* 60ULL \* 1000ULL/);
  assert.match(schedule, /kSpotifyTimedTalkAboutStartMs = 4ULL \* 60ULL \* 1000ULL/);
  assert.match(schedule, /kSpotifyTimedLonesomeStartMs = 20ULL \* 60ULL \* 1000ULL/);
  assert.match(schedule, /slotLocalElapsed < kSpotifyTimedTalkAboutStartMs[\s\S]*Target::BitterBlue/);
  assert.match(schedule, /slotLocalElapsed < kSpotifyTimedLonesomeStartMs[\s\S]*Target::TalkAbout/);
  assert.match(schedule, /return Target::LonesomeRabbit/);
  assert.match(schedule, /elapsed \/ kSpotifyTimedSlotOffsetMs\) % slots_\.size\(\)/);
  assert.match(schedule, /slot\.lastTimedLonesomeWave != wave/);
  assert.match(schedule, /NavigateTimedSlot\(slot\)/);
});

test('timed playback owns Spotify autoplay and no longer depends on repeat-one', () => {
  assert.match(wrapper, /RewriteSpotifyLegacyAutoplayScript/);
  assert.match(wrapper, /__homePanelLonesomeRabbitLoop/);
  assert.match(wrapper, /__homePanelSakuraTalkAboutPlayback/);
  assert.match(wrapper, /#include "spotify_timed_sequence\.inc"/);
  assert.match(timed, /5EjWZuODqEPQ9eq7XCmITh/);
  assert.match(timed, /2ZQy2mlwQodabAILwZ02Ed/);
  assert.match(timed, /2f2Ik9JeinFVWZuFb3i35b/);
  assert.match(timed, /kSpotifyTimedLonesomeScript/);
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
  assert.match(
    schedule,
    /desired == TimedSpotifyTarget::LonesomeRabbit[\s\S]*slotLocalElapsed >= kSpotifyTimedLonesomeStartMs/,
  );
});

test('mode changes never navigate all six Spotify WebViews simultaneously', () => {
  assert.match(wrapper, /#define SetPodcastMode SetPodcastModeImmediate/);
  assert.match(schedule, /void SpotifyWebViews::SetPodcastMode\(bool podcastWindowActive\) noexcept/);
  assert.match(schedule, /if \(!slots_\[i\]\.webview\) slots_\[i\]\.playing = true/);
  assert.doesNotMatch(
    schedule,
    /for \(Slot& slot : slots_\) \{[\s\S]*slot\.webview->Navigate/,
  );
  assert.match(schedule, /TVer does not reset the YouTube master clock/);
});
