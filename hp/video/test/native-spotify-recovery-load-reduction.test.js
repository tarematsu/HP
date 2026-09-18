import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const scoped = source('spotify_scoped_track_reconcile.inc');
const music = source('spotify_music_target.inc');
const phase = source('spotify_phase_sync.inc');
const lifecycle = source('spotify_host_lifecycle.inc');

test('Spotify recovery reuses connected Play controls and media elements', () => {
  assert.match(scoped, /__homePanelSpotifyDomCache/);
  assert.match(scoped, /domCache\.path !== targetPath/);
  assert.match(scoped, /const cachedButtons = \(key, selector\) =>/);
  assert.match(scoped, /Array\.isArray\(domCache\[key\]\)/);
  assert.match(scoped, /document\.querySelectorAll\(selector\)/);
  assert.match(scoped, /cached && cached\.isConnected !== false && !cached\.ended/);
  assert.match(scoped, /domCache\.media = selected/);
  assert.match(scoped, /domCache\.nowPlayingLink/);
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

test('Spotify recovery does not change the WebView2 memory target', () => {
  assert.doesNotMatch(
    phase,
    /SetSpotifyMemoryUsageTarget|put_MemoryUsageTargetLevel|COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_(?:LOW|NORMAL)/,
  );
  assert.doesNotMatch(
    lifecycle,
    /SetSpotifyMemoryUsageTarget|put_MemoryUsageTargetLevel|COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_(?:LOW|NORMAL)/,
  );
});
