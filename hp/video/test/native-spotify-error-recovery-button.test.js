import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const reconcile = readFileSync(
  new URL('../../native/src/spotify_scoped_track_reconcile.inc', import.meta.url),
  'utf8',
);

test('Spotify startup detects structural error surfaces without clicking recovery UI', () => {
  assert.match(reconcile, /const hasErrorSurface = Array\.from\(document\.querySelectorAll\(/);
  assert.match(reconcile, /\[role="alertdialog"\]/);
  assert.match(reconcile, /\[data-testid\*="error" i\]/);
  assert.match(reconcile, /\[id\*="error" i\]/);
  assert.match(reconcile, /if \(hasErrorSurface && !activeMedia\) return 'startup-failure';/);
});

test('Spotify startup has no localized error-button retry vocabulary', () => {
  assert.doesNotMatch(reconcile, /retry\|reload\|refresh\|reconnect/);
  assert.doesNotMatch(reconcile, /再試行|réessayer|reintentar|다시 시도|重试/);
});

test('Spotify startup never clicks an error recovery button', () => {
  assert.doesNotMatch(reconcile, /__homePanelSpotifyErrorRecovery/);
  assert.doesNotMatch(reconcile, /lastClickAt|errorRecoveryButton\.click\(\)/);
  assert.match(reconcile, /return 'startup-failure'/);
});
