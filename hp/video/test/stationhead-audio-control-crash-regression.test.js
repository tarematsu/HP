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

test('A/B and MUTE actions only update the persistent playback WebView', () => {
  const audioApplication = section(
    audioSource,
    'void StationheadPlayer::ApplyMute() const noexcept',
    '// Window B\'s isolated WebView2 environment',
  );

  assert.match(audioApplication, /webview_\.As\(&audio\)/);
  assert.match(audioApplication, /audio->put_IsMuted/);
  assert.doesNotMatch(audioApplication, /authWebview_/);
});

test('volume-script failures remain inside the noexcept audio action boundary', () => {
  const applyVolume = section(
    audioSource,
    'void StationheadPlayer::ApplyVolume() const noexcept',
    '// Window B\'s isolated WebView2 environment',
  );

  assert.match(applyVolume, /try \{[\s\S]*StationheadVolumeScript/);
  assert.match(applyVolume, /catch \(\.\.\.\)/);
  assert.match(applyVolume, /SUCCEEDED\(result\) \? percent : -1/);
  assert.match(
    applyVolume,
    /catch \(\.\.\.\) \{[\s\S]*appliedVolumePercent_\.store\(-1/,
  );
});
