import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const reconcile = readFileSync(
  new URL('../../native/src/spotify_scoped_track_reconcile.inc', import.meta.url),
  'utf8',
);

test('Spotify error recovery prefers language-independent structural detection', () => {
  assert.match(reconcile, /const findErrorRecoveryButton = \(\) =>/);
  assert.match(reconcile, /\[role=\"alert\"\]/);
  assert.match(reconcile, /\[role=\"alertdialog\"\]/);
  assert.match(reconcile, /\[data-testid\*=\"error\" i\]/);
  assert.match(reconcile, /const strongErrorSurface =/);
  assert.match(reconcile, /root\.querySelector\('h1,h2,h3,\[role=\"heading\"\]'\)/);
  assert.match(
    reconcile,
    /if \(actions\.length === 1 && strongErrorSurface\) return actions\[0\];/,
  );
});

test('Spotify error recovery has semantic fallbacks without requiring Japanese', () => {
  assert.match(reconcile, /retry\|reload\|refresh\|reconnect/);
  assert.match(reconcile, /try again/);
  assert.match(reconcile, /再試行/);
  assert.match(reconcile, /réessayer/);
  assert.match(reconcile, /reintentar/);
  assert.match(reconcile, /다시 시도/);
  assert.match(reconcile, /重试/);
});

test('Spotify error recovery clicks with cooldown then resumes normal probing', () => {
  assert.match(reconcile, /__homePanelSpotifyErrorRecovery/);
  assert.match(reconcile, /now - Number\(recovery\.lastClickAt \|\| 0\) >= 3000/);
  assert.match(reconcile, /errorRecoveryButton\.click\(\)/);
  assert.match(reconcile, /return playbackProbeMs;/);
});
