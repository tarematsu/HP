import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const environment = readFileSync(
  new URL('../../native/src/shared_webview_environment.cpp', import.meta.url),
  'utf8',
);
const webview = readFileSync(
  new URL('../../native/src/sh_webview.cpp', import.meta.url),
  'utf8',
);

const section = (source, start, end) => {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.ok(startAt >= 0 && endAt > startAt);
  return source.slice(startAt, endAt);
};

test('shared environment leaves image loading available for Spotify reCAPTCHA', () => {
  assert.match(environment, /blockImages = false;/);
  assert.match(environment, /blockFonts = true;/);
});

test('Stationhead playback keeps its resource blocker but Spotify auth does not', () => {
  const playback = section(
    webview,
    'void StationheadPlayer::ConfigureWebView()',
    'void StationheadPlayer::ConfigureAuthWebView()',
  );
  const auth = section(
    webview,
    'void StationheadPlayer::ConfigureAuthWebView()',
    'void StationheadPlayer::CloseWebView()',
  );

  assert.match(playback, /ApplyStationheadResourceBlocking\(/);
  assert.doesNotMatch(auth, /ApplyStationheadResourceBlocking\(/);
  assert.match(auth, /ApplyMediaWebViewFeaturePolicy\(/);
});
