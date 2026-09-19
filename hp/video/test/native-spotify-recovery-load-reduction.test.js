import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const scoped = source('spotify_scoped_track_reconcile.inc');
const music = source('spotify_music_target.inc');
const phase = source('spotify_phase_sync.inc');
const lifecycle = source('spotify_host_lifecycle.inc');
const schedule = source('spotify_stagger_schedule.inc');

test('Spotify startup uses one small per-target state instead of a DOM recovery cache', () => {
  assert.match(scoped, /__homePanelSpotifySimpleStartState/);
  assert.match(scoped, /__homePanelSpotifySimpleMediaProbe/);
  assert.match(scoped, /state = \{ path: targetPath, playIssued: false, failedSamples: 0 \}/);
  assert.doesNotMatch(scoped, /__homePanelSpotifyDomCache|cachedButtons|domCache\.media|domCache\.nowPlayingLink/);
});

test('fully verified Spotify playback exits before source or Play-Pause DOM reconciliation', () => {
  const start = music.indexOf('void SpotifyWebViews::ReconcileMusicTarget');
  const end = music.indexOf('\n}  // namespace hp', start);
  assert.ok(start >= 0 && end > start);
  const reconcile = music.slice(start, end);
  const fastPath = reconcile.indexOf('slot.playbackConfirmed && slot.nativeAudioStartVerified');
  const sourceCheck = reconcile.indexOf('SlotMatchesMusicTarget(slot)');
  const scriptProbe = reconcile.indexOf('kSpotifyScopedTrackReconcileScript');
  assert.ok(fastPath >= 0);
  assert.ok(sourceCheck > fastPath);
  assert.ok(scriptProbe > sourceCheck);
  assert.match(reconcile, /SlotStateIsHealthy\(slot\.state\)/);
  assert.match(reconcile, /timedCompletionDeadlineGeneration == slot\.targetGeneration/);
});

test('Spotify recovery drops stale completion deadlines outside healthy playback', () => {
  assert.match(
    schedule,
    /if \(SlotStateIsHealthy\(slot\.state\)\) continue;[\s\S]*slot\.timedCompletionDeadlineTick = 0;[\s\S]*slot\.timedCompletionDeadlineGeneration = 0;[\s\S]*ProbeDueTimedCompletions\(now\)/,
  );
  assert.match(
    schedule,
    /reloadMediaSurface[\s\S]*slot\.nativeAudioStartVerified = false;[\s\S]*slot\.timedCompletionDeadlineTick = 0;[\s\S]*slot\.timedCompletionDeadlineGeneration = 0;/,
  );
});

test('Spotify recovery does not manage the WebView2 memory target', () => {
  assert.doesNotMatch(phase, /ApplySpotifyPermanentResourceMode|put_MemoryUsageTargetLevel/);
  assert.doesNotMatch(
    lifecycle,
    /SetSpotifyMemoryUsageTarget|put_MemoryUsageTargetLevel|COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_(?:LOW|NORMAL)/,
  );
});
