import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url), 'utf8');
const runtime = readFileSync(
  new URL('../../native/src/spotify_media_observer_runtime.inc', import.meta.url), 'utf8');
const events = readFileSync(
  new URL('../../native/src/spotify_media_observer_events.inc', import.meta.url), 'utf8');
const music = readFileSync(
  new URL('../../native/src/spotify_music_target.inc', import.meta.url), 'utf8');
const wrapper = readFileSync(
  new URL('../../native/src/spotify_webviews.inc', import.meta.url), 'utf8');
const phase = readFileSync(
  new URL('../../native/src/spotify_phase_sync.inc', import.meta.url), 'utf8');
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url), 'utf8');
const schedule = readFileSync(
  new URL('../../native/src/spotify_stagger_schedule.inc', import.meta.url), 'utf8');
const lifecycle = readFileSync(
  new URL('../../native/src/spotify_host_lifecycle.inc', import.meta.url), 'utf8');

test('each Spotify slot owns a generation-fenced completion deadline', () => {
  assert.match(header, /ULONGLONG timedCompletionDeadlineTick = 0/);
  assert.match(header, /ULONGLONG timedCompletionDeadlineGeneration = 0/);
  assert.match(rotation, /timedCompletionDeadlineGeneration != slot\.targetGeneration/);
  assert.match(rotation, /eventGeneration != target->targetGeneration/);
});

test('validated music start feeds one deadline calculator with two-second grace', () => {
  assert.match(runtime, /const remainingDurationMs = media =>/);
  assert.match(runtime, /\(\(duration - currentTime\) \/ playbackRate\) \* 1000/);
  assert.match(runtime, /postFields\('spotify:timed-started', String\(remainingMs\)\)/);
  assert.match(rotation, /ParseSpotifyStartedEvent/);
  assert.match(rotation, /ArmMusicCompletionDeadlineFromStart/);
  assert.match(music, /kSpotifyNavigationCompletionGraceMs = 2ULL \* 1000ULL/);
  assert.match(music, /slot\.timedCompletionDeadlineTick = playbackStartTick \+ completionDelayMs/);
  assert.doesNotMatch(rotation, /spotify:timed-plan/);
});

test('ended is best-effort deadline shortening, not a second completion path', () => {
  assert.match(events, /addEventListener\('ended', observeEnded, true\)/);
  assert.match(events, /post\('spotify:timed-ended'\)/);
  assert.match(rotation, /ParseSpotifyGenerationEvent\([\s\S]*spotify:timed-ended/);
  assert.match(rotation, /ShortenMusicCompletionDeadlineAtEnd/);
  assert.match(music, /slot\.timedCompletionDeadlineTick = endedTick/);

  const endedStart = rotation.indexOf('if (ended) {');
  const endedEnd = rotation.indexOf('SetSlotState(*target, SlotState::Playing)', endedStart);
  assert.ok(endedStart >= 0 && endedEnd > endedStart);
  assert.doesNotMatch(rotation.slice(endedStart, endedEnd), /AdvanceTimedRotationSlot/);
});

test('observer has no completion planner or heartbeat lifecycle tracking', () => {
  assert.doesNotMatch(wrapper, /spotify_media_observer_completion\.inc/);
  assert.doesNotMatch(
    events,
    /addEventListener\('(?:timeupdate|seeking|seeked|waiting|stalled|pause)'/,
  );
  assert.doesNotMatch(events, /spotify:timed-plan/);
  assert.doesNotMatch(runtime, /postCompletionPlan|clearCompletionPlan|completionPlan/);
});

test('due native deadline advances the rotation without asking Spotify again', () => {
  const dueStart = rotation.indexOf(
    'void SpotifyWebViews::ProbeDueTimedCompletions(ULONGLONG now) noexcept');
  const dueEnd = rotation.indexOf(
    '\nvoid SpotifyWebViews::ArmTimedEndObserver', dueStart);
  assert.ok(dueStart >= 0 && dueEnd > dueStart);
  const due = rotation.slice(dueStart, dueEnd);

  assert.match(due, /SpotifyDeadlineWithInterruptionHold/);
  assert.match(due, /effectiveDeadline > now/);
  assert.match(due, /AdvanceTimedRotationSlot\(slot, now\)/);
  assert.match(due, /ArmCompletionDeadlineTimer\(\)/);
  assert.doesNotMatch(due, /PostWebMessageAsString/);
  assert.doesNotMatch(due, /slot\.webview/);
});

test('same generation cannot postpone the armed A to B deadline with repeated start events', () => {
  assert.match(music, /timedCompletionDeadlineTick != 0/);
  assert.match(music, /timedCompletionDeadlineGeneration == slot\.targetGeneration/);
  assert.match(rotation, /ArmMusicCompletionDeadlineFromStart/);
  assert.doesNotMatch(rotation, /candidateDeadline/);
  assert.match(rotation, /interruptionEnded/);
  assert.match(rotation, /timedCompletionDeadlineTick \+ extension/);
});

test('threadpool timer is the primary completion wake-up under six-WebView load', () => {
  assert.match(header, /PTP_TIMER completionDeadlineTimer_ = nullptr/);
  assert.match(header, /CompletionDeadlineTimerProc/);
  assert.match(phase, /CreateThreadpoolTimer/);
  assert.match(phase, /SetThreadpoolTimer\(completionDeadlineTimer_, &due, 0, 0\)/);
  assert.match(phase, /PostMessageW\(host, kSpotifyCompletionDeadlineMessage, 0, 0\)/);
  assert.match(lifecycle, /message == kSpotifyCompletionDeadlineMessage/);
  assert.match(lifecycle, /ProbeDueTimedCompletions\(GetTickCount64\(\)\)/);
  assert.match(lifecycle, /WaitForThreadpoolTimerCallbacks\(completionDeadlineTimer_, TRUE\)/);
  assert.match(lifecycle, /CloseThreadpoolTimer\(completionDeadlineTimer_\)/);
});

test('WM_TIMER remains only a fallback scheduler, not the sole completion clock', () => {
  assert.match(header, /kSpotifyAccountStartOffsetMs = 40ULL \* 1000ULL/);
  assert.match(phase, /threadpool timer is the primary completion wake-up/i);
  assert.match(phase, /::SetTimer\(host, kSpotifyRobustReconcileTimer, delay/);
  assert.match(schedule, /ProbeDueTimedCompletions\(now\)/);
  assert.doesNotMatch(rotation, /SetTimer\(/);
  assert.doesNotMatch(schedule, /SetTimer\(/);
});
