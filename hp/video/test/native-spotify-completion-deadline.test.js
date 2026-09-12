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

test('each Spotify slot owns a generation-fenced completion deadline', () => {
  assert.match(header, /ULONGLONG timedCompletionDeadlineTick = 0/);
  assert.match(header, /ULONGLONG timedCompletionDeadlineGeneration = 0/);
  assert.match(rotation, /timedCompletionDeadlineGeneration != slot\.targetGeneration/);
  assert.match(rotation, /eventGeneration != target->targetGeneration/);
  assert.match(rotation, /timedCompletionDeadlineGeneration = eventGeneration/);
});

test('WebView publishes remaining time and native probes near the deadline', () => {
  assert.match(completion, /postFields\('spotify:timed-plan', String\(remainingMs\)\)/);
  assert.match(completion, /lastCompletionPlanDeadlineAt = Date\.now\(\) \+ remainingMs/);
  assert.match(completion, /const completionPlanExpired = \(\) =>/);
  assert.match(completion, /spotify:completion-probe/);
  assert.match(events, /runtime\.probeCompletion = \(\) =>/);
  assert.match(events, /completionPlanExpired\(\)/);
  assert.match(events, /return postCompletionPlan\(media, true\)/);
  assert.match(rotation, /kSpotifyCompletionProbeLeadMs/);
  assert.match(rotation, /remainingMs - kSpotifyCompletionProbeLeadMs/);
  assert.match(rotation, /spotify:completion-probe/);
});

test('one shared adaptive timer wakes for the earliest of six independent deadlines', () => {
  assert.match(header, /kSpotifyAccountStartOffsetMs = 40ULL \* 1000ULL/);
  assert.match(phase, /slot\.timedCompletionDeadlineTick - now/);
  assert.match(phase, /std::min\([\s\S]*timedCompletionDeadlineTick - now/);
  assert.match(phase, /::SetTimer\(host, kSpotifyRobustReconcileTimer, delay/);
  assert.match(schedule, /ProbeDueTimedCompletions\(now\)/);
  assert.doesNotMatch(rotation, /SetTimer\(/);
  assert.doesNotMatch(schedule, /SetTimer\(/);
});

test('pause, seek and stall invalidate stale completion deadlines', () => {
  assert.match(events, /document\.addEventListener\('pause'[\s\S]*clearCompletionPlan\(\)/);
  assert.match(events, /document\.addEventListener\('seeking'[\s\S]*clearCompletionPlan\(\)/);
  assert.match(events, /\['waiting', 'stalled'\][\s\S]*clearCompletionPlan\(\)/);
  assert.match(completion, /post\('spotify:timed-plan-clear'\)/);
  assert.match(rotation, /if \(planCleared\)[\s\S]*timedCompletionDeadlineTick = 0/);
});
