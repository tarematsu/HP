import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function workflow() {
  return readFileSync(new URL('../../.github/workflows/refresh-music-service-playlists.yml', import.meta.url), 'utf8');
}

function entry() {
  return readFileSync(new URL('../scripts/music-service-playlist-refresh-entry.js', import.meta.url), 'utf8');
}

test('Spotify and Apple Music playlist sweeps run at 02:00 and 14:00 JST', () => {
  const source = workflow();
  assert.match(source, /02:00 JST.*14:00 JST/);
  assert.match(source, /cron: '0 5,17 \* \* \*'/);
  assert.match(source, /workflow_dispatch:/);
  assert.doesNotMatch(source, /^\s*push:/m);
  assert.match(source, /run_sweep spotify true/);
  assert.match(source, /run_sweep apple false/);
  assert.match(source, /processed >= target/);
  assert.match(source, /if \(\( known > target \)\); then target=\$known; fi/);
  assert.match(source, /timeout-minutes: 60/);
});

test('playlist sweep entry bypasses the legacy Apple daily gate only for the Actions sweep', () => {
  const source = entry();
  assert.match(source, /APPLE_STATE_KEY = 'apple-music\/playlists\/state\.json'/);
  assert.match(source, /clearAppleDailyGate/);
  assert.match(source, /collectAppleMusicPlaylists/);
  assert.match(source, /collectSpotifyPlaylists/);
  assert.match(source, /canonicalizeAppleMusicPlaylistPresentation/);
  assert.match(source, /service === 'spotify'/);
  assert.match(source, /service === 'apple'/);
});
