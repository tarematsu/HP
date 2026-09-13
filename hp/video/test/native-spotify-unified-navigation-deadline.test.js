import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url), 'utf8');
const music = readFileSync(
  new URL('../../native/src/spotify_music_target.inc', import.meta.url), 'utf8');
const click = readFileSync(
  new URL('../../native/src/spotify_background_click.inc', import.meta.url), 'utf8');
const events = readFileSync(
  new URL('../../native/src/spotify_media_observer_events.inc', import.meta.url), 'utf8');
const controller = readFileSync(
  new URL('../../native/src/spotify_controller_lifecycle.inc', import.meta.url), 'utf8');
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url), 'utf8');
const phase = readFileSync(
  new URL('../../native/src/spotify_phase_sync.inc', import.meta.url), 'utf8');
const cloud = readFileSync(
  new URL('../../native/src/spotify_cloud_playlist.inc', import.meta.url), 'utf8');
const schedule = readFileSync(
  new URL('../../native/src/spotify_stagger_schedule.inc', import.meta.url), 'utf8');

test('music duration and four-minute fallback share one two-second-grace deadline calculator', () => {
  const start = music.indexOf(
    'void SpotifyWebViews::ArmMusicCompletionDeadlineFromStart');
  const end = music.indexOf('\nvoid SpotifyWebViews::ShortenMusicCompletionDeadlineAtEnd', start);
  assert.ok(start >= 0 && end > start);
  const arm = music.slice(start, end);

  assert.match(music, /kSpotifyNavigationFailsafeMs = 4ULL \* 60ULL \* 1000ULL/);
  assert.match(music, /kSpotifyNavigationCompletionGraceMs = 2ULL \* 1000ULL/);
  assert.match(arm, /observedRemainingMs/);
  assert.match(arm, /completionDelayMs = kSpotifyNavigationFailsafeMs/);
  assert.match(arm, /std::min\(durationMs, maxDurationMs\)/);
  assert.match(
    arm,
    /slot\.timedCompletionDeadlineTick = playbackStartTick \+ completionDelayMs/,
  );
  assert.match(arm, /slot\.timedCompletionDeadlineGeneration = slot\.targetGeneration/);
  assert.match(arm, /ArmRobustScheduler\(\)/);
  assert.doesNotMatch(arm, /ArmCompletionDeadlineTimer|timedPlaybackStartTick/);
});

test('navigation selects a track but no longer starts its completion clock', () => {
  const start = music.indexOf('void SpotifyWebViews::NavigateMusicTarget');
  const end = music.indexOf('\nvoid SpotifyWebViews::ReconcileMusicTarget', start);
  assert.ok(start >= 0 && end > start);
  const navigate = music.slice(start, end);

  assert.match(navigate, /slot\.webview->Navigate\(track->url\.c_str\(\)\)/);
  assert.doesNotMatch(navigate, /timedCompletionDeadlineTick\s*=/);
  assert.doesNotMatch(navigate, /completionDelayMs/);
});

test('trusted Play mousePressed is the playback-start anchor without a duplicate stored start tick', () => {
  assert.match(click, /const ULONGLONG playbackStartTick = GetTickCount64\(\)/);
  assert.match(click, /mousePressed/);
  assert.match(
    click,
    /ArmMusicCompletionDeadlineFromStart\([\s\S]*\*target, playbackStartTick\)/,
  );
  assert.doesNotMatch(header + music, /timedPlaybackStartTick/);
});

test('direct playback start enters the same deadline helper with observed remaining time', () => {
  assert.match(rotation, /ParseSpotifyStartedEvent/);
  assert.match(
    rotation,
    /ArmMusicCompletionDeadlineFromStart\([\s\S]*\*target, now, remainingMs/,
  );
});

test('validated ended only shortens the same deadline', () => {
  assert.match(events, /document\.addEventListener\('ended', observeEnded, true\)/);
  assert.match(events, /state\.targetMedia !== media/);
  assert.match(events, /state\.interruptionStartedAt/);
  assert.match(events, /post\('spotify:timed-ended'\)/);
  assert.match(rotation, /L"spotify:timed-ended"/);
  assert.match(rotation, /ShortenMusicCompletionDeadlineAtEnd\(\*target, now\)/);
  assert.match(music, /slot\.timedCompletionDeadlineTick = endedTick/);

  const endedStart = rotation.indexOf('if (ended) {');
  const endedEnd = rotation.indexOf('SetSlotState(*target, SlotState::Playing)', endedStart);
  assert.ok(endedStart >= 0 && endedEnd > endedStart);
  assert.doesNotMatch(rotation.slice(endedStart, endedEnd), /AdvanceTimedRotationSlot/);
});

test('NavigationCompleted no longer owns a second duration deadline path', () => {
  assert.doesNotMatch(controller, /kSpotifyNavigationCompletionGraceMs/);
  assert.doesNotMatch(controller, /durationDeadline/);
  assert.doesNotMatch(
    controller,
    /timedCycleTracks\[target->timedRotationPosition\][\s\S]*durationMs/,
  );
});

test('measured ad time extends the same completion deadline', () => {
  assert.match(rotation, /ParseSpotifyInterruptionEndedEvent/);
  assert.match(
    rotation,
    /const ULONGLONG extension = std::min\([\s\S]*interruptionMs,[\s\S]*kSpotifyMaxInterruptionHoldMs\)/,
  );
  assert.match(
    rotation,
    /target->timedCompletionDeadlineTick\s*=\s*[\s\S]*target->timedCompletionDeadlineTick \+ extension/,
  );
  assert.doesNotMatch(rotation, /timedAdCompletionDeadlineTick/);
  assert.doesNotMatch(rotation, /timedAdvertisementDeadlineTick/);
});

test('active ads only hold the unified deadline temporarily', () => {
  assert.match(phase, /SpotifyDeadlineWithInterruptionHold/);
  assert.match(
    phase,
    /SpotifyDeadlineWithInterruptionHold\([\s\S]*slot\.timedCompletionDeadlineTick,[\s\S]*slot\.timedInterruptionStartTick/,
  );
});

test('first rotation waits for startup cloud config opportunity', () => {
  assert.match(header, /BeginInitialCloudPlaylistWait/);
  assert.match(header, /InitialCloudPlaylistReady/);
  assert.match(cloud, /kSpotifyInitialCloudSyncSettleMs = 10ULL \* 1000ULL/);
  assert.match(cloud, /kSpotifyInitialCloudSyncFallbackMs = 30ULL \* 1000ULL/);
  assert.match(schedule, /BeginInitialCloudPlaylistWait\(now\)/);
  assert.match(schedule, /if \(!InitialCloudPlaylistReady\(now\)\) return/);
  assert.match(schedule, /scheduleStartTick_ = 0/);
  assert.match(phase, /!initialCloudPlaylistReady_[\s\S]*kSpotifySchedulerBootstrapMs/);
});

test('the unified deadline advances queue state and scheduler starts navigation', () => {
  const start = rotation.indexOf(
    'void SpotifyWebViews::ProbeDueTimedCompletions(ULONGLONG now) noexcept');
  const end = rotation.indexOf('\nvoid SpotifyWebViews::ArmTimedEndObserver', start);
  assert.ok(start >= 0 && end > start);
  const due = rotation.slice(start, end);

  assert.match(due, /effectiveDeadline > now/);
  assert.match(due, /AdvanceTimedRotationSlot\(slot\)/);
  assert.doesNotMatch(due, /NavigateMusicTarget/);
  assert.match(schedule, /ReconcileMusicTarget\(slot\)/);
});
