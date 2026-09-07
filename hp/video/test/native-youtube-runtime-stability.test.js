import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const reliablePlayAll = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_playall_reliable.inc', import.meta.url),
  'utf8',
);
const youtubePolicy = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_policy.inc', import.meta.url),
  'utf8',
);
const trustedInput = readFileSync(
  new URL('../../native/src/renderer_panels/media_trusted_input.inc', import.meta.url),
  'utf8',
);

test('YouTube playlist startup can resolve the first video before Polymer DOM settles', () => {
  assert.match(reliablePlayAll, /window\.ytInitialData/);
  assert.match(reliablePlayAll, /playlistVideoRenderer/);
  assert.match(reliablePlayAll, /playlistPanelVideoRenderer/);
  assert.match(reliablePlayAll, /navigateVideoId\(renderer\.videoId\)/);
  assert.match(reliablePlayAll, /visited < 5000/);
  assert.match(reliablePlayAll, /values\.length - 1/);
  assert.match(reliablePlayAll, /url\.searchParams\.set\('list', playlistId\)/);
});

test('a playlist that survives the legacy fixed-coordinate fallback is reloaded', () => {
  assert.match(reliablePlayAll, /__homePanelYoutubePlaylistStartupState/);
  assert.match(youtubePolicy, /location\.pathname\.startsWith\('\/playlist'\)/);
  assert.match(youtubePolicy, /__homePanelYoutubePlaylistStartupState/);
  assert.match(youtubePolicy, /Date\.now\(\) - since >= 8000/);
  assert.match(youtubePolicy, /return true/);
});

test('repeated YouTube toggle actions have per-action settle windows', () => {
  assert.match(youtubePolicy, /const guardedPoint =/);
  assert.match(youtubePolicy, /guardedPoint\(target, 'skip-ad', 750\)/);
  assert.match(youtubePolicy, /guardedPoint\(target, 'play', 2000\)/);
  assert.match(youtubePolicy, /guardedPoint\(target, 'fullscreen', 2500\)/);
});

test('trusted CDP clicks are serialized and stale locks recover', () => {
  assert.match(trustedInput, /kNativeMediaTrustedClickStaleMs = 3000ULL/);
  assert.match(trustedInput, /gNativeMediaTrustedClickStartedAt/);
  assert.match(trustedInput, /NativeMediaAcquireTrustedClick\(\)/);
  assert.match(trustedInput, /compare_exchange_weak/);
  assert.match(trustedInput, /NativeMediaReleaseTrustedClick\(clickToken\)/);
});
