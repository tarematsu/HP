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

test('each account gets restart-safe TALKABOUT no later than its two-hour deadline', () => {
  assert.match(header, /kSpotifyPodcastIntervalMs =\s*2ULL \* 60ULL \* 60ULL \* 1000ULL/);
  assert.match(header, /ULONGLONG podcastDueTick = 0/);
  assert.match(header, /int64_t podcastDueUnixMs = 0/);
  assert.match(rotation, /spotify-talkabout-schedule\.txt/);
  assert.match(rotation, /EnsurePodcastScheduleLoaded/);
  assert.match(rotation, /MoveFileExW[\s\S]*MOVEFILE_REPLACE_EXISTING/);
  assert.match(rotation, /StartOverduePodcastBreak/);
  assert.match(rotation, /now < slot\.podcastDueTick/);
  assert.match(rotation, /lastPodcastDispatchTick_[\s\S]*kSpotifyAccountStartOffsetMs/);
  assert.match(schedule, /StartOverduePodcastBreak\(now\)[\s\S]*AdvanceExpiredTimedRotation\(now\)/);
  assert.doesNotMatch(rotation, /kSpotifyPodcastBreakEveryCycles/);
  assert.doesNotMatch(rotation, /timedRotationCycle %/);
});

test('the next two-hour deadline is persisted only after TALKABOUT is confirmed playing', () => {
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
    /MarkPodcastPlaybackStarted[\s\S]*podcastDueTick = now \+ kSpotifyPodcastIntervalMs[\s\S]*SavePodcastScheduleState\(\)/,
  );
  assert.match(rotation, /due <= 0[\s\S]*kSpotifyAccountStartOffsetMs/);
  assert.match(rotation, /CompletePodcastBreak[\s\S]*timedRotationPosition = 0[\s\S]*ApplyTimedRotationTarget\(slot\)/);
});

test('music keeps one shared four-minute deadline while podcast break is exempt', () => {
  assert.match(header, /kSpotifyMusicTrackDeadlineMs =\s*4ULL \* 60ULL \* 1000ULL/);
  assert.match(rotation, /now - slot\.timedPlaybackStartTick < kSpotifyMusicTrackDeadlineMs/);
  assert.match(rotation, /BeginPodcastBreak[\s\S]*timedPlaybackStartTick = 0/);
  assert.match(rotation, /podcastBreakActive \|\|[\s\S]*timedPlaybackStartTick == 0/);
});