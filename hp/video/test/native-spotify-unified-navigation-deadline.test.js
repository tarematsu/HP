import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const music = readFileSync(
  new URL('../../native/src/spotify_music_target.inc', import.meta.url), 'utf8');
const click = readFileSync(
  new URL('../../native/src/spotify_background_click.inc', import.meta.url), 'utf8');
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

test('music duration and five-minute fallback share one deadline calculator', () => {
  const start = music.indexOf(
    'void SpotifyWebViews::ArmMusicCompletionDeadlineFromStart');
  const end = music.indexOf('\nvoid SpotifyWebViews::NavigateMusicTarget', start);
  assert.ok(start >= 0 && end > start);
  const arm = music.slice(start, end);

  assert.match(music, /kSpotifyNavigationFailsafeMs = 5ULL \* 60ULL \* 1000ULL/);
  assert.match(music, /kSpotifyNavigationCompletionGraceMs = 5ULL \* 1000ULL/);
  assert.match(arm, /completionDelayMs = kSpotifyNavigationFailsafeMs/);
  assert.match(arm, /timedCycleTracks\[slot\.timedRotationPosition\]\.durationMs/);
  assert.match(arm, /std::min\(durationMs, maxDurationMs\)/);
  assert.match(
    arm,
    /slot\.timedCompletionDeadlineTick = playbackStartTick \+ completionDelayMs/,
  );
  assert.match(arm, /slot\.timedCompletionDeadlineGeneration = slot\.targetGeneration/);
  assert.match(arm, /ArmCompletionDeadlineTimer\(\)/);
});

test('navigation selects a track but no longer starts its completion clock', () => {
  const start = music.indexOf('void SpotifyWebViews::NavigateMusicTarget');
  const end = music.indexOf('\nvoid SpotifyWebViews::ReconcileMusicTarget', start);
  assert.ok(start >= 0 && end > start);
  const navigate = music.slice(start, end);

  assert.match(navigate, /slot\.webview->Navigate\(target\.url\)/);
  assert.doesNotMatch(navigate, /timedCompletionDeadlineTick\s*=/);
  assert.doesNotMatch(navigate, /completionDelayMs/);
});

test('trusted Play mousePressed is the primary playback-start anchor', () => {
  assert.match(click, /const ULONGLONG playbackStartTick = GetTickCount64\(\)/);
  assert.match(click, /mousePressed/);
  assert.match(
    click,
    /ArmMusicCompletionDeadlineFromStart\([\s\S]*\*target, playbackStartTick\)/,
  );
  assert.match(music, /slot\.timedPlaybackStartTick = playbackStartTick/);
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
  assert.match(cloud, /kSpotifyInitialCloudSyncSettleMs = 10ULL \* 1000ULL/);
  assert.match(cloud, /kSpotifyInitialCloudSyncFallbackMs = 30ULL \* 1000ULL/);
  assert.match(schedule, /BeginInitialCloudPlaylistWait\(now\)/);
  assert.match(schedule, /if \(!InitialCloudPlaylistReady\(now\)\) return/);
  assert.match(schedule, /scheduleStartTick_ = 0/);
  assert.match(phase, /if \(!initialCloudPlaylistReady_\) return kSpotifyRobustUrgentTickMs/);
});

test('the unified deadline still advances through the common rotation path', () => {
  const start = rotation.indexOf(
    'void SpotifyWebViews::ProbeDueTimedCompletions(ULONGLONG now) noexcept');
  const end = rotation.indexOf('\nvoid SpotifyWebViews::ArmTimedEndObserver', start);
  assert.ok(start >= 0 && end > start);
  const due = rotation.slice(start, end);

  assert.match(due, /effectiveDeadline > now/);
  assert.match(due, /AdvanceTimedRotationSlot\(slot, now\)/);
});
