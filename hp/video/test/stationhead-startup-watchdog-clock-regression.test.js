import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(new URL(`../../native/src/${name}`, import.meta.url), 'utf8');
const appHeader = source('app.h');
const timingHeader = source('monotonic_time.h');
const playerHeader = source('sh.h');
const playerSource = source('sh.cpp');
const webviewSource = source('sh_webview.cpp');

function section(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing section: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section terminator: ${end}`);
  return text.slice(from, to);
}

test('App startup keeps only the active monotonic timestamp', () => {
  assert.match(appHeader, /MonotonicElapsedTimestamp startupAt_;/);
  assert.doesNotMatch(appHeader, /dashboardAudioReadySince_|playbackReadyAt_|secondaryStarted_/);
  const elapsed = section(timingHeader, 'class MonotonicElapsedTimestamp',
    'class AtomicMonotonicElapsedTimestamp');
  assert.match(elapsed, /GetTickCount64\(\)/);
  assert.doesNotMatch(elapsed, /system_clock/);
});

test('WebView creation and auth watchdogs use monotonic elapsed timestamps', () => {
  assert.match(playerHeader, /MonotonicElapsedTimestamp creationStartedAt_;/);
  assert.match(playerHeader, /MonotonicElapsedTimestamp authControllerStartedAt_;/);
  assert.match(playerSource, /nowMs - creationStartedAt_ >= kStationheadWebViewCreationTimeoutMs/);
  assert.match(playerSource, /nowMs - authControllerStartedAt_ >= kStationheadAuthControllerTimeoutMs/);
});

test('startup script and recreate deadlines use uptime deadlines', () => {
  assert.match(playerHeader, /MonotonicDeadline recreateAt_;/);
  assert.match(playerHeader, /MonotonicDeadline startupScriptDeadline_;/);
  const deadline = section(timingHeader, 'class MonotonicDeadline',
    'class MonotonicProjectedDeadline');
  assert.match(deadline, /deadlineTick_/);
  assert.match(deadline, /GetTickCount64\(\) >= deadlineTick_/);
  assert.match(webviewSource,
    /startupScriptDeadline_ =\s*UnixMillis\(\) \+ kStationheadStartupScriptRegistrationTimeoutMs/);
});

test('startup watchdogs force an immediate player wake', () => {
  const wake = section(timingHeader, 'class StartupAwareWakeDeadline',
    '}  // namespace hp');
  assert.match(wake, /creating_->load/);
  assert.match(wake, /startupScriptDeadline_->Active\(\)/);
  assert.match(wake, /authControllerStartedAt_->Active\(\)/);
  assert.match(wake, /startupWatchdogPending \? 0 : static_cast<int64_t>\(value_\)/);
});

test('resetting watchdog state releases the forced wake', () => {
  assert.match(playerSource, /creationStartedAt_ = 0;/);
  assert.match(playerSource, /authControllerStartedAt_ = 0;/);
  assert.match(webviewSource, /startupScriptDeadline_ = 0;/);
});
