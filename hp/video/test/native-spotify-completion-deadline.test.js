import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const header = source('spotify_webviews.h');
const runtime = source('spotify_media_observer_runtime.inc');
const events = source('spotify_media_observer_events.inc');
const music = source('spotify_music_target.inc');
const wrapper = source('spotify_webviews.inc');
const phase = source('spotify_phase_sync.inc');
const rotation = source('spotify_timed_end_rotation.inc');
const schedule = source('spotify_stagger_schedule.inc');
const lifecycle = source('spotify_host_lifecycle.inc');

test('each Spotify slot owns one target-generation-fenced completion deadline', () => {
  assert.match(header, /ULONGLONG timedCompletionDeadlineTick = 0/);
  assert.match(header, /ULONGLONG timedCompletionDeadlineGeneration = 0/);
  assert.match(rotation, /timedCompletionDeadlineGeneration != slot\.targetGeneration/);
  assert.match(rotation, /eventGeneration != target->targetGeneration/);
});

test('validated start and resume share one deadline calculator with two-second grace', () => {
  assert.match(runtime, /const remainingDurationMs = media =>/);
  assert.match(runtime, /postFields\('spotify:timed-started', String\(remainingMs\)\)/);
  assert.match(runtime, /postFields\('spotify:timed-resumed', String\(remainingMs\)\)/);
  assert.match(rotation, /ParseSpotifyStartedEvent/);
  assert.match(rotation, /ParseSpotifyResumedEvent/);
  assert.match(rotation, /SetMusicCompletionDeadline/);
  assert.match(music, /kSpotifyNavigationCompletionGraceMs = 2ULL \* 1000ULL/);
  assert.match(music, /slot\.timedCompletionDeadlineTick = playbackStartTick \+ completionDelayMs/);
  assert.match(music, /bool replaceExisting/);
});

test('ended is best-effort deadline shortening, not a second completion path', () => {
  assert.match(events, /addEventListener\('ended', observeEnded, true\)/);
  assert.match(events, /post\('spotify:timed-ended'\)/);
  assert.match(rotation, /spotify:timed-ended/);
  assert.match(rotation, /ShortenMusicCompletionDeadlineAtEnd/);
  assert.match(music, /slot\.timedCompletionDeadlineTick = endedTick/);

  const endedStart = rotation.indexOf('if (ended) {');
  const endedEnd = rotation.indexOf('SetSlotState(*target, SlotState::Playing)', endedStart);
  assert.ok(endedStart >= 0 && endedEnd > endedStart);
  assert.doesNotMatch(rotation.slice(endedStart, endedEnd), /AdvanceTimedRotationSlot/);
});

test('observer has no completion planner heartbeat or interruption clock', () => {
  assert.doesNotMatch(wrapper, /spotify_media_observer_completion\.inc/);
  assert.doesNotMatch(events, /addEventListener\('(?:timeupdate|seeking|seeked|waiting|stalled|pause)'/);
  assert.doesNotMatch(runtime, /postCompletionPlan|clearCompletionPlan|completionPlan|interruptionStartedAt/);
  assert.doesNotMatch(rotation + phase, /SpotifyDeadlineWithInterruptionHold|kSpotifyMaxInterruptionHoldMs/);
});

test('due native deadline advances queue state without touching a WebView', () => {
  const dueStart = rotation.indexOf(
    'void SpotifyWebViews::ProbeDueTimedCompletions(ULONGLONG now) noexcept');
  const dueEnd = rotation.indexOf(
    '\nvoid SpotifyWebViews::ArmTimedEndObserver', dueStart);
  assert.ok(dueStart >= 0 && dueEnd > dueStart);
  const due = rotation.slice(dueStart, dueEnd);

  assert.match(due, /slot\.timedCompletionDeadlineTick > now/);
  assert.match(due, /AdvanceTimedRotationSlot\(slot\)/);
  assert.doesNotMatch(due, /NavigateMusicTarget|ReconcileMusicTarget|PostWebMessageAsString|slot\.webview/);
});

test('repeated start cannot postpone a deadline but a validated resume can replace it', () => {
  assert.match(music, /if \(!replaceExisting && slot\.timedCompletionDeadlineTick != 0/);
  assert.match(rotation, /SetMusicCompletionDeadline\([\s\S]*remainingMs, resumed/);
  assert.doesNotMatch(rotation, /interruptionEnded|timedCompletionDeadlineTick \+ extension/);
});

test('one threadpool timer owns every Spotify timed wake-up', () => {
  assert.match(header, /PTP_TIMER schedulerTimer_ = nullptr/);
  assert.match(header, /SchedulerTimerProc/);
  assert.match(header, /std::atomic<bool> schedulerWakePosted_\{false\}/);
  assert.doesNotMatch(header, /completionDeadlineTimer_|CompletionDeadlineTimerProc/);
  assert.match(phase, /CreateThreadpoolTimer\([\s\S]*SchedulerTimerProc/);
  assert.match(phase, /SetThreadpoolTimer\(schedulerTimer_, &due, 0, 0\)/);
  assert.match(lifecycle, /message == kSpotifySchedulerMessage/);
  assert.match(lifecycle, /RunStaggeredReconcile\(\)/);
});

test('scheduler considers completion startup recovery async timeout and hourly safety audit deadlines', () => {
  assert.match(header, /kSpotifyAccountStartOffsetMs = 10ULL \* 1000ULL/);
  assert.match(phase, /kSpotifyRecoveryRetryMs = 5ULL \* 1000ULL/);
  assert.match(phase, /kSpotifyAsyncOperationTimeoutMs = 12ULL \* 1000ULL/);
  assert.match(phase, /kSpotifyHealthyAuditMs = 60U \* 60U \* 1000U/);
  assert.match(phase, /considerTick\(slot\.timedCompletionDeadlineTick\)/);
  assert.match(phase, /considerTick\(slot\.nextRecoveryTick\)/);
  assert.match(phase, /slot\.asyncStartedTick \+ kSpotifyAsyncOperationTimeoutMs/);
  assert.match(schedule, /ProbeDueTimedCompletions\(now\)/);
  assert.doesNotMatch(phase + schedule + rotation, /::SetTimer\(|KillTimer\(|StaggeredReconcileTimerProc/);
});
