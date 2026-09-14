import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const header = source('spotify_webviews.h');
const music = source('spotify_music_target.inc');
const click = source('spotify_background_click.inc');
const events = source('spotify_media_observer_events.inc');
const controller = source('spotify_controller_lifecycle.inc');
const rotation = source('spotify_timed_end_rotation.inc');
const phase = source('spotify_phase_sync.inc');
const cloud = source('spotify_cloud_playlist.inc');
const schedule = source('spotify_stagger_schedule.inc');

test('music duration and four-minute fallback share one two-second-grace deadline calculator', () => {
  const start = music.indexOf('void SpotifyWebViews::SetMusicCompletionDeadline');
  const end = music.indexOf('\nvoid SpotifyWebViews::ShortenMusicCompletionDeadlineAtEnd', start);
  assert.ok(start >= 0 && end > start);
  const arm = music.slice(start, end);
  assert.match(music, /kSpotifyNavigationFailsafeMs = 4ULL \* 60ULL \* 1000ULL/);
  assert.match(music, /kSpotifyNavigationCompletionGraceMs = 2ULL \* 1000ULL/);
  assert.match(arm, /observedRemainingMs/);
  assert.match(arm, /completionDelayMs = kSpotifyNavigationFailsafeMs/);
  assert.match(arm, /std::min\(durationMs, maxDurationMs\)/);
  assert.match(arm, /timedCompletionDeadlineTick = playbackStartTick \+ completionDelayMs/);
  assert.match(arm, /timedCompletionDeadlineGeneration = slot\.targetGeneration/);
});

test('target routing does not start the completion clock before playback confirmation', () => {
  const start = music.indexOf('void SpotifyWebViews::NavigateMusicTarget');
  const end = music.indexOf('\nvoid SpotifyWebViews::ReconcileMusicTarget', start);
  const navigate = music.slice(start, end);
  assert.match(navigate, /ExecuteScript\(\s*kSpotifySpaRouteScript/);
  assert.match(navigate, /requestedView->Navigate\(currentTrack->url\.c_str\(\)\)/);
  assert.doesNotMatch(navigate, /timedCompletionDeadlineTick\s*=/);
});

test('trusted Play input never starts the completion clock by itself', () => {
  assert.match(click, /ArmTimedEndObserver\(slot\)/);
  assert.match(click, /trustedClickBlockedUntilTick = now \+ kSpotifyPlaybackStartRetryMs/);
  assert.doesNotMatch(click, /SetMusicCompletionDeadline/);
  assert.doesNotMatch(click, /playbackStartTick/);
  assert.doesNotMatch(header + music, /timedPlaybackStartTick/);
});

test('failed Play and SPA handoff use short targeted retries', () => {
  assert.match(music, /kSpotifyTrackTransitionRetryMs = 500ULL/);
  assert.match(music, /kSpotifyPlaybackStartRetryMs = 1500ULL/);
  assert.match(music, /callbackNow \+ kSpotifyTrackTransitionRetryMs/);
  assert.match(music, /callbackNow \+ kSpotifyPlaybackStartRetryMs/);
  assert.match(click, /nextRecoveryTick = now \+ kSpotifyPlaybackStartRetryMs/);
});

test('direct playback start and resume enter the same deadline helper', () => {
  assert.match(rotation, /ParseSpotifyStartedEvent/);
  assert.match(rotation, /ParseSpotifyResumedEvent/);
  assert.match(rotation, /SetMusicCompletionDeadline\([\s\S]*\*target, now, remainingMs, resumed/);
});

test('validated ended only shortens the same deadline', () => {
  assert.match(events, /document\.addEventListener\('ended', observeEnded, true\)/);
  assert.match(events, /state\.interrupted/);
  assert.match(events, /post\('spotify:timed-ended'\)/);
  assert.match(rotation, /ShortenMusicCompletionDeadlineAtEnd\(\*target, now\)/);
  assert.match(music, /slot\.timedCompletionDeadlineTick = endedTick/);
});

test('NavigationCompleted does not own a second duration deadline path', () => {
  assert.doesNotMatch(controller, /kSpotifyNavigationCompletionGraceMs|durationDeadline|timedPlaybackStartTick/);
});

test('non-target playback resumes by replacing the same completion deadline', () => {
  assert.match(rotation, /ParseSpotifyResumedEvent/);
  assert.match(music, /bool replaceExisting/);
  assert.match(music, /if \(!replaceExisting && slot\.timedCompletionDeadlineTick != 0/);
  assert.doesNotMatch(rotation + phase + header, /ParseSpotifyInterruptionEndedEvent|SpotifyDeadlineWithInterruptionHold|timedInterruptionStartTick|kSpotifyMaxInterruptionHoldMs/);
});

test('first rotation waits for startup cloud config opportunity while controller warmup may begin', () => {
  assert.match(header, /BeginInitialCloudPlaylistWait/);
  assert.match(header, /InitialCloudPlaylistReady/);
  assert.match(cloud, /kSpotifyInitialCloudSyncSettleMs = 10ULL \* 1000ULL/);
  assert.match(cloud, /kSpotifyInitialCloudSyncFallbackMs = 30ULL \* 1000ULL/);
  assert.match(schedule, /BeginInitialCloudPlaylistWait\(now\)/);
  assert.match(schedule, /const bool cloudPlaylistReady = InitialCloudPlaylistReady\(now\)/);
  assert.match(schedule, /if \(!slot\.webview\) \{[\s\S]*BeginControllerCreate\(slot\)[\s\S]*return/);
  assert.match(schedule, /if \(!cloudPlaylistReady\) return;[\s\S]*InitializeTimedRotationSlot\(slot\)/);
});

test('the unified deadline advances queue state and scheduler starts later work', () => {
  const start = rotation.indexOf('void SpotifyWebViews::ProbeDueTimedCompletions');
  const end = rotation.indexOf('\nvoid SpotifyWebViews::ArmTimedEndObserver', start);
  const due = rotation.slice(start, end);
  assert.match(due, /slot\.timedCompletionDeadlineTick > now/);
  assert.match(due, /AdvanceTimedRotationSlot\(slot\)/);
  assert.doesNotMatch(due, /NavigateMusicTarget/);
  assert.match(schedule, /ReconcileMusicTarget\(slot\)/);
});
