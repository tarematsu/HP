import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const audioSource = readFileSync(
  new URL('../../native/src/sh_audio.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('MUTE only updates the persistent playback WebView', () => {
  const audioApplication = section(
    audioSource,
    'void StationheadPlayer::ApplyMute() const noexcept',
    'void StationheadPlayer::EnsureDistinctBrowserIdentity() noexcept',
  );

  assert.match(audioApplication, /ComPtr<ICoreWebView2> webview = webview_/);
  assert.match(audioApplication, /webview\.As\(&audio\)/);
  assert.match(audioApplication, /audio->put_IsMuted/);
  assert.doesNotMatch(audioApplication, /authWebview_|ExecuteScript|StationheadVolumeScript/);
  assert.doesNotMatch(audioSource, /SetVolume|ApplyVolume|StationheadVolumeScript/);
});
