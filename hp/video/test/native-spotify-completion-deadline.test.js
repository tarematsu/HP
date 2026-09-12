import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url), 'utf8');
const runtime = readFileSync(
  new URL('../../native/src/spotify_media_observer_runtime.inc', import.meta.url), 'utf8');
const events = readFileSync(
  new URL('../../native/src/spotify_media_observer_events.inc', import.meta.url), 'utf8');
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
  assert.match(rotation, /timedCompletionDeadlineGeneration = eventGeneration/);
});

test('validated music start publishes one remaining duration for native timing', () => {
  assert.match(runtime, /const remainingDurationMs = media =>/);
  assert.match(runtime, /\(\(duration - currentTime\) \/ playbackRate\) \* 1000/);
  assert.match(runtime, /postFields\('spotify:timed-started', String\(remainingMs\)\)/);
  assert.match(rotation, /ParseSpotifyStartedEvent/);
  assert.match(rotation, /target->timedCompletionDeadlineTick = now \+ remainingMs/);
  assert.doesNotMatch(rotation, /spotify:timed-plan/);
  assert.doesNotMatch(rotation, /spotify:timed-ended/);
});

test('observer has no completion planner or terminal lifecycle tracking', () => {
  assert.doesNotMatch(wrapper, /spotify_media_observer_completion\.inc/);
  assert.doesNotMatch(
    events,
    /addEventListener\('(?:timeupdate|seeking|seeked|waiting|stalled|pause|ended)'/,
  );
  assert.doesNotMatch(events, /spotify:timed-plan|spotify:timed-ended/);
  assert.doesNotMatch(runtime, /postCompletionPlan|clearCompletionPlan|completionPlan/);
});

test('due native deadline advances the rotation without asking Spotify again', () => {
  const dueStart = rotation.indexOf(
    'void SpotifyWebViews::ProbeDueTimedCompletions(ULONGLONG now) noexcept');
  const dueEnd = rotation.indexOf(
    '\nvoid SpotifyWebViews::ArmTimedEndObserver', dueStart);
  assert.ok(dueStart >= 0 && dueEnd > dueStart);
  const due = rotation.slice(dueStart, dueEnd);

  assert.match(due, /timedCompletionDeadlineTick > now/);
  assert.match(due, /AdvanceTimedRotationSlot\(slot, now\)/);
  assert.match(due, /ArmCompletionDeadlineTimer\(\)/);
  assert.doesNotMatch(due, /PostWebMessageAsString/);
  assert.doesNotMatch(due, /slot\.webview/);
});

test('same generation cannot postpone or clear the armed A to B deadline', () => {
  const handlerStart = rotation.indexOf('const bool started = ParseSpotifyStartedEvent');
  const handlerEnd = rotation.indexOf('\n            }).Get(),', handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  const handler = rotation.slice(handlerStart, handlerEnd);

  assert.match(handler, /timedCompletionDeadlineTick == 0/);
  assert.match(handler, /timedCompletionDeadlineGeneration != eventGeneration/);
  assert.match(handler, /timedCompletionDeadlineTick = now \+ remainingMs/);
  assert.doesNotMatch(handler, /candidateDeadline/);
  assert.doesNotMatch(handler, /timedCompletionDeadlineTick = 0/);
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
