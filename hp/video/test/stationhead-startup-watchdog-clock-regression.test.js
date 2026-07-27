import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appHeader = readFileSync(
  new URL('../../native/src/app.h', import.meta.url),
  'utf8',
);
const playerHeader = readFileSync(
  new URL('../../native/src/sh.h', import.meta.url),
  'utf8',
);
const playerSource = readFileSync(
  new URL('../../native/src/sh.cpp', import.meta.url),
  'utf8',
);
const webviewSource = readFileSync(
  new URL('../../native/src/sh_webview.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('App startup gates retain UTC timestamps but measure elapsed time with uptime', () => {
  assert.match(appHeader, /MonotonicElapsedTimestamp startupAt_;/);
  assert.match(appHeader, /MonotonicElapsedTimestamp dashboardAudioReadySince_;/);
  assert.match(appHeader, /MonotonicElapsedTimestamp playbackReadyAt_;/);

  const elapsedClock = section(
    playerHeader,
    'class MonotonicElapsedTimestamp',
    'class MonotonicDeadline',
  );
  assert.match(elapsedClock, /GetTickCount64\(\)/);
  assert.match(elapsedClock, /wallTime_/);
  assert.match(elapsedClock, /operator-\(/);
  assert.doesNotMatch(elapsedClock, /system_clock/);
});

test('WebView creation and auth watchdog starts use monotonic elapsed timestamps', () => {
  assert.match(playerHeader, /MonotonicElapsedTimestamp creationStartedAt_;/);
  assert.match(playerHeader, /MonotonicElapsedTimestamp createdAt_;/);
  assert.match(playerHeader, /MonotonicElapsedTimestamp authControllerStartedAt_;/);
  assert.match(playerSource, /creationStartedAt_ = UnixMillis\(\);/);
  assert.match(playerSource, /nowMs - creationStartedAt_ >= kStationheadWebViewCreationTimeoutMs/);
  assert.match(playerSource, /nowMs - authControllerStartedAt_ >= kStationheadAuthControllerTimeoutMs/);
});

test('startup script and recreate deadlines are converted once to uptime deadlines', () => {
  assert.match(playerHeader, /MonotonicDeadline recreateAt_;/);
  assert.match(playerHeader, /MonotonicDeadline startupScriptDeadline_;/);

  const deadlineClock = section(
    playerHeader,
    'class MonotonicDeadline',
    'class MonotonicProjectedDeadline',
  );
  assert.match(deadlineClock, /wallDeadline - wallNow/);
  assert.match(deadlineClock, /deadlineTick_/);
  assert.match(deadlineClock, /GetTickCount64\(\) >= deadlineTick_/);
  assert.doesNotMatch(deadlineClock, /system_clock/);

  assert.match(
    webviewSource,
    /startupScriptDeadline_ =\s*UnixMillis\(\) \+ kStationheadStartupScriptRegistrationTimeoutMs/,
  );
  assert.match(playerSource, /nowMs >= startupScriptDeadline_/);
  assert.match(playerSource, /nowMs >= recreateAt_/);
});

test('startup watchdogs bypass the ordinary long player wake deadline', () => {
  const wakeClock = section(
    playerHeader,
    'class StartupAwareWakeDeadline',
    'struct StationheadDailyPlayPoint',
  );
  assert.match(wakeClock, /creating_->load/);
  assert.match(wakeClock, /startupScriptDeadline_->Active\(\)/);
  assert.match(wakeClock, /authControllerStartedAt_->Active\(\)/);
  assert.match(
    wakeClock,
    /startupWatchdogPending \? 0 : static_cast<int64_t>\(value_\)/,
  );
  assert.match(wakeClock, /MonotonicProjectedDeadline value_;/);
  assert.match(
    playerHeader,
    /StartupAwareWakeDeadline nextTickAt_\{[\s\S]*creating_[\s\S]*startupScriptDeadline_[\s\S]*authControllerStartedAt_[\s\S]*startupNavigationStarted_/,
  );
});

test('resetting startup watchdog state also releases the forced wake', () => {
  assert.match(playerSource, /creationStartedAt_ = 0;/);
  assert.match(playerSource, /authControllerStartedAt_ = 0;/);
  assert.match(webviewSource, /startupScriptDeadline_ = 0;/);
  assert.match(webviewSource, /creationStartedAt_ = 0;/);
});
