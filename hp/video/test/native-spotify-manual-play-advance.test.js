import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const events = readFileSync(
  new URL('../../native/src/spotify_media_observer_events.inc', import.meta.url),
  'utf8',
);

test('manual Spotify Play arms the same generation-fenced start token as native input', () => {
  assert.match(events, /document\.addEventListener\('click', armManualPlay, true\)/);
  assert.match(events, /raw\.closest\('button,\[role="button"\]'\)/);
  assert.match(events, /testId === 'play-button'/);
  assert.match(events, /testId === 'control-button-playpause'/);
  assert.match(events, /label\.includes\('pause'\)/);
  assert.match(events, /label\.includes\('一時停止'\)/);
  assert.match(
    events,
    /armTrustedStart\(String\(window\.__homePanelSpotifyGeneration \|\| '0'\)\)/,
  );

  const clickHook = events.indexOf("document.addEventListener('click', armManualPlay, true)");
  const playingHook = events.indexOf("document.addEventListener('playing', observe, true)");
  assert.ok(clickHook >= 0 && playingHook > clickHook);
});
