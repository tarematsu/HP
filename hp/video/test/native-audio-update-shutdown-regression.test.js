import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const audioSource = readFileSync(
  new URL('../../native/src/sh_audio.cpp', import.meta.url),
  'utf8',
);
const startupFallbackSource = readFileSync(
  new URL('../../native/src/app_startup_tick_fallback.cpp', import.meta.url),
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
  assert.match(audioApplication, /try \{[\s\S]*StationheadVolumeScript/);
  assert.match(audioApplication, /catch \(\.\.\.\)/);
  assert.match(
    audioApplication,
    /SUCCEEDED\(result\) \? percent : -1/,
  );
});

test('legacy updater close is accepted only while the installer lock exists', () => {
  assert.match(
    startupFallbackSource,
    /kUpdaterInstallerMutexName\[\][\s\S]*Local\\\\HomePanelUpdaterInstaller/,
  );
  assert.match(
    startupFallbackSource,
    /OpenMutexW\(SYNCHRONIZE, FALSE, kUpdaterInstallerMutexName\)/,
  );

  const protectedProc = section(
    startupFallbackSource,
    'LRESULT CALLBACK ProtectedWindowProc(',
    'void InstallWindowProtection(',
  );
  assert.match(
    protectedProc,
    /message == kUpdateShutdownMessage[\s\S]*CallWindowProcW\(original, window, WM_CLOSE/,
  );
  assert.match(
    protectedProc,
    /if \(!gUserCloseRequested && !VerifiedUpdaterInstallerRunning\(\)\) return 0;/,
  );
  assert.ok(
    protectedProc.indexOf('message == kUpdateShutdownMessage') <
      protectedProc.indexOf('message == WM_CLOSE'),
  );
});
