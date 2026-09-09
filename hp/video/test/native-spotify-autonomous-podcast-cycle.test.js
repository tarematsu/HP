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

test('each account inserts exactly one TALKABOUT episode after every ten ABCD cycles', () => {
  assert.match(rotation, /kSpotifyPodcastBreakEveryCycles = 10ULL/);
  assert.match(rotation, /timedRotationPosition == 0U[\s\S]*\+\+slot\.timedRotationCycle/);
  assert.match(rotation, /timedRotationCycle % kSpotifyPodcastBreakEveryCycles == 0ULL/);
  assert.match(rotation, /BeginPodcastBreak\(slot, now\);[\s\S]*return;/);
  assert.match(rotation, /slot\.timedTarget = TimedSpotifyTarget::TalkAbout/);
  assert.match(
    timed,
    /target->timedTarget != TimedSpotifyTarget::TalkAbout[\s\S]*CompletePodcastBreak\(\*target, now\)/,
  );
  assert.match(rotation, /CompletePodcastBreak[\s\S]*ApplyTimedRotationTarget\(slot\)/);
});

test('music keeps one shared four-minute deadline while podcast break is exempt', () => {
  assert.match(header, /kSpotifyMusicTrackDeadlineMs =\s*4ULL \* 60ULL \* 1000ULL/);
  assert.match(rotation, /now - slot\.timedPlaybackStartTick < kSpotifyMusicTrackDeadlineMs/);
  assert.match(rotation, /BeginPodcastBreak[\s\S]*timedPlaybackStartTick = 0/);
  assert.match(rotation, /podcastBreakActive \|\|[\s\S]*timedPlaybackStartTick == 0/);
});