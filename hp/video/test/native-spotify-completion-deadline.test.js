import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url), 'utf8');
const completion = readFileSync(
  new URL('../../native/src/spotify_media_observer_completion.inc', import.meta.url), 'utf8');
const events = readFileSync(
  new URL('../../native/src/spotify_media_observer_events.inc', import.meta.url), 'utf8');
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

test('WebView publishes a projected end time and native compensates delivery delay', () => {
  assert.match(
    completion,
    /postFields\([\s\S]*'spotify:timed-plan',[\s\S]*String\(remainingMs\),[\s\S]*String\(state\.lastCompletionPlanDeadlineAt\)/,
  );
  assert.match(rotation, /ULONGLONG projectedEndUnixMs = 0/);
  assert.match(rotation, /SpotifySystemUnixMillisecondsNow\(\)/);
  assert.match(rotation, /projectedEndUnixMs <= wallNow/);
  assert.match(rotation, /std::min\(effectiveRemainingMs, wallRemaining\)/);
  assert.match(rotation, /const ULONGLONG candidateDeadline =\s*now \+ std::max<ULONGLONG>\(effectiveRemainingMs, 1ULL\)/);
  assert.match(rotation, /target->timedCompletionDeadlineTick == 0/);
  assert.match(rotation, /candidateDeadline < target->timedCompletionDeadlineTick/);
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
  assert.doesNotMatch(due, /spotify:completion-probe/);
  assert.doesNotMatch(due, /PostWebMessageAsString/);
  assert.doesNotMatch(due, /slot\.webview/);
});

test('same-generation repeat rewind cannot postpone A to B', () => {
  const planStart = rotation.indexOf('if (planned) {');
  const planEnd = rotation.indexOf('\n              if (planCleared)', planStart);
  assert.ok(planStart >= 0 && planEnd > planStart);
  const plan = rotation.slice(planStart, planEnd);

  assert.match(plan, /candidateDeadline < target->timedCompletionDeadlineTick/);
  assert.match(plan, /timedCompletionDeadlineTick = candidateDeadline/);
  assert.match(plan, /ArmCompletionDeadlineTimer\(\)/);
  assert.doesNotMatch(plan, /timedCompletionDeadlineTick = now \+ remainingMs/);

  const clearStart = rotation.indexOf('if (planCleared) {');
  const clearEnd = rotation.indexOf('\n              if (started)', clearStart);
  assert.ok(clearStart >= 0 && clearEnd > clearStart);
  const clear = rotation.slice(clearStart, clearEnd);
  assert.doesNotMatch(clear, /timedCompletionDeadlineTick = 0/);
  assert.doesNotMatch(clear, /timedCompletionDeadlineGeneration = 0/);
});

test('real ended remains an early fallback but is not required for progress', () => {
  assert.match(events, /document\.addEventListener\('ended'/);
  assert.match(rotation, /if \(ended\) \{[\s\S]*AdvanceTimedRotationSlot\(\*target, now\)/);
  assert.match(rotation, /first valid playback plan[\s\S]*authoritative[\s\S]*completion clock/i);
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
