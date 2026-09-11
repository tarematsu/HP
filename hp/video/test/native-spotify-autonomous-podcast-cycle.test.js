import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const lifecycle = readFileSync(
  new URL('../../native/src/renderer_lifecycle.cpp', import.meta.url), 'utf8');
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url), 'utf8');
const schedule = readFileSync(
  new URL('../../native/src/spotify_stagger_schedule.inc', import.meta.url), 'utf8');
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url), 'utf8');
const timed = readFileSync(
  new URL('../../native/src/spotify_timed_sequence.inc', import.meta.url), 'utf8');
const cloud = readFileSync(
  new URL('../../native/src/spotify_cloud_playlist.inc', import.meta.url), 'utf8');
const cycle = readFileSync(
  new URL('../../native/src/spotify_rotation_cycle.inc', import.meta.url), 'utf8');

test('Spotify playback state is autonomous from YouTube/TVer phase', () => {
  assert.match(header, /scheduleStartTick_ = 0/);
  assert.match(schedule, /StartAutonomousSchedule/);
  assert.doesNotMatch(header + schedule, /SetPodcastMode|podcastMode_|youtubeCycleStartTick_/);
  assert.match(
    lifecycle,
    /void SetSpotifyMediaPhase\(bool\) noexcept \{[\s\S]*Spotify intentionally ignores YouTube\/TVer phase changes/,
  );
  assert.doesNotMatch(lifecycle, /gSpotifyTverPhase|SetPodcastMode/);
});

test('legacy two-hour TALKABOUT scheduler is removed completely', () => {
  const source = header + schedule + rotation + cloud + timed;
  assert.doesNotMatch(source, /kSpotifyPodcastIntervalMs/);
  assert.doesNotMatch(source, /SpotifyPodcastIntervalMs/);
  assert.doesNotMatch(source, /podcastDueTick|podcastDueUnixMs/);
  assert.doesNotMatch(source, /spotify-talkabout-schedule\.txt/);
  assert.doesNotMatch(source, /EnsurePodcastScheduleLoaded|SavePodcastScheduleState/);
  assert.doesNotMatch(source, /StartOverduePodcastBreak|MarkPodcastPlaybackStarted/);
  assert.doesNotMatch(source, /lastPodcastDispatchTick_|intervalMinutes/);
});

test('TALKABOUT is eligible only through an inline rotation group', () => {
  assert.match(header, /bool includeTalkAbout = false/);
  assert.match(cloud, /GetNamedBoolean\(L"includeTalkAbout", false\)/);
  assert.match(cycle, /group\.includeTalkAbout && SpotifyPodcastTargetReady\(\)/);
  assert.match(cycle, /SpotifyPodcastPath\(\)/);
  assert.match(rotation, /target\.path == SpotifyPodcastPath\(\)/);
  assert.match(rotation, /TimedSpotifyTarget::TalkAbout/);
  assert.doesNotMatch(schedule, /PodcastBreak|TALKABOUT owns an independent/);
});

test('inline TALKABOUT advances only after episode completion', () => {
  assert.match(
    timed,
    /std::wstring_view\(json\) == L"\\"completed\\""[\s\S]*CompletePodcastBreak\(\*target, now\)/,
  );
  assert.match(
    rotation,
    /CompletePodcastBreak[\s\S]*podcastBreakActive = false[\s\S]*AdvanceTimedRotationSlot\(slot, now\)/,
  );
  assert.doesNotMatch(rotation + schedule, /AdvanceExpiredTimedRotation|kSpotifyMusicTrackDeadlineMs/);
});
