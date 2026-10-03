import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function dispatcher() {
  return readFileSync(new URL('../src/cron-dispatcher-entry.js', import.meta.url), 'utf8');
}

function entry() {
  return readFileSync(new URL('../scripts/music-service-playlist-refresh-entry.js', import.meta.url), 'utf8');
}

test('Spotify and Apple Music playlist sweeps are dispatched at 02:00 and 14:00 JST', () => {
  const source = dispatcher();
  assert.match(source, /MUSIC_PLAYLIST_REFRESH_CRON = '0 5,17 \* \* \*'/);
  assert.match(source, /minute === 0 && \[5, 17\]\.includes\(hour\)/);
  assert.match(source, /'music-playlist-refresh'/);
  assert.match(source, /env\?\.AMAZON_MUSIC_SCHEDULED/);
  assert.match(source, /MUSIC_PLAYLIST_REFRESH_CRON, scheduledAt/);
});

test('playlist sweep entry bypasses the legacy Apple daily gate only for the full sweep', () => {
  const source = entry();
  assert.match(source, /APPLE_STATE_KEY = 'apple-music\/playlists\/state\.json'/);
  assert.match(source, /clearAppleDailyGate/);
  assert.match(source, /collectAppleMusicPlaylists/);
  assert.match(source, /collectSpotifyPlaylists/);
  assert.match(source, /canonicalizeAppleMusicPlaylistPresentation/);
  assert.match(source, /service === 'spotify'/);
  assert.match(source, /service === 'apple'/);
});
