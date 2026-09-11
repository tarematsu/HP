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

test('each account gets restart-safe TALKABOUT no later than its cloud interval capped at two hours', () => {
  assert.match(header, /kSpotifyPodcastIntervalMs =\s*2ULL \* 60ULL \* 60ULL \* 1000ULL/);
  assert.match(cloud, /kSpotifyMaxPodcastIntervalMinutes = 120/);
  assert.match(cloud, /SpotifyPodcastIntervalMs\(\) const noexcept/);
  assert.match(header, /ULONGLONG podcastDueTick = 0/);
  assert.match(header, /int64_t podcastDueUnixMs = 0/);
  assert.match(rotation, /spotify-talkabout-schedule\.txt/);
  assert.match(rotation, /EnsurePodcastScheduleLoaded/);
  assert.match(rotation, /MoveFileExW[\s\S]*MOVEFILE_REPLACE_EXISTING/);
  assert.match(rotation, /StartOverduePodcastBreak/);
  assert.match(rotation, /now < slot\.podcastDueTick/);
  assert.match(rotation, /lastPodcastDispatchTick_[\s\S]*kSpotifyAccountStartOffsetMs/);
  assert.match(schedule, /StartOverduePodcastBreak\(now\)/);
  assert.doesNotMatch(schedule, /AdvanceExpiredTimedRotation/);
  assert.doesNotMatch(rotation, /kSpotifyPodcastBreakEveryCycles/);
  assert.doesNotMatch(rotation, /timedRotationCycle %/);
});

test('the next deadline is persisted only after TALKABOUT is confirmed playing', () => {
  assert.match(
    timed,
    /json && std::wstring_view\(json\) == L"true"[\s\S]*MarkPodcastPlaybackStarted\(\*target, now\)[\s\S]*SetSlotState\(\*target, SlotState::Playing\)/,
  );
  assert.match(
    timed,
    /std::wstring_view\(json\) == L"\\"completed\\""[\s\S]*MarkPodcastPlaybackStarted\(\*target, now\)[\s\S]*CompletePodcastBreak\(\*target, now\)/,
  );
  assert.match(
    rotation,
    /MarkPodcastPlaybackStarted[\s\S]*const ULONGLONG interval = SpotifyPodcastIntervalMs\(\)[\s\S]*podcastDueTick = now \+ interval[\s\S]*SavePodcastScheduleState\(\)/,
  );
  assert.match(rotation, /due <= 0[\s\S]*kSpotifyAccountStartOffsetMs/);
  assert.match(rotation, /CompletePodcastBreak[\s\S]*timedRotationPosition = 0[\s\S]*PrepareTimedRotationCycle\(slot\)[\s\S]*ApplyTimedRotationTarget\(slot\)/);
});

test('music has no wall-clock deadline while TALKABOUT keeps its independent deadline', () => {
  assert.doesNotMatch(header, /kSpotifyMusicTrackDeadlineMs/);
  assert.doesNotMatch(rotation + schedule, /AdvanceExpiredTimedRotation|kSpotifyMusicTrackDeadlineMs/);
  assert.match(rotation, /BeginPodcastBreak[\s\S]*timedTarget = TimedSpotifyTarget::TalkAbout/);
  assert.match(schedule, /StartOverduePodcastBreak\(now\)/);
});