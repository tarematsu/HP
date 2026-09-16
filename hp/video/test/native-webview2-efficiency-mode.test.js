import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(
  new URL('../../native/src/app.cpp', import.meta.url),
  'utf8',
);
const sharedEnvironment = readFileSync(
  new URL('../../native/src/shared_webview_environment.cpp', import.meta.url),
  'utf8',
);

test('native app process does not enable Windows Efficiency mode', () => {
  assert.doesNotMatch(app, /ApplyEfficiencyModeToCurrentProcess/);
  assert.doesNotMatch(app, /IDLE_PRIORITY_CLASS/);
  assert.doesNotMatch(app, /ProcessPowerThrottling/);
  assert.doesNotMatch(app, /Native process Efficiency mode/);
});

test('shared WebView2 processes do not force Windows Efficiency mode', () => {
  assert.doesNotMatch(sharedEnvironment, /ApplyEfficiencyModeToProcess/);
  assert.doesNotMatch(sharedEnvironment, /ApplyEfficiencyModeToEnvironment/);
  assert.doesNotMatch(sharedEnvironment, /EnableEfficiencyModeForEnvironment/);
  assert.doesNotMatch(sharedEnvironment, /PROCESS_POWER_THROTTLING_EXECUTION_SPEED/);
  assert.doesNotMatch(sharedEnvironment, /ProcessPowerThrottling/);
  assert.doesNotMatch(sharedEnvironment, /SetPriorityClass\(/);
  assert.doesNotMatch(sharedEnvironment, /IDLE_PRIORITY_CLASS/);
});
