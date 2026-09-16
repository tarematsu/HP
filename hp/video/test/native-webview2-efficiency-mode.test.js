import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sharedEnvironment = readFileSync(
  new URL('../../native/src/shared_webview_environment.cpp', import.meta.url),
  'utf8',
);

test('all shared WebView2 processes keep EcoQoS without IDLE priority starvation', () => {
  assert.match(sharedEnvironment, /ICoreWebView2Environment8/);
  assert.match(sharedEnvironment, /GetProcessInfos/);
  assert.match(sharedEnvironment, /add_ProcessInfosChanged/);
  assert.match(sharedEnvironment, /PROCESS_POWER_THROTTLING_EXECUTION_SPEED/);
  assert.match(sharedEnvironment, /SetProcessInformation\(process, ProcessPowerThrottling/);
  assert.match(sharedEnvironment, /SetPriorityClass\(process, BELOW_NORMAL_PRIORITY_CLASS\)/);
  assert.doesNotMatch(sharedEnvironment, /SetPriorityClass\(process, IDLE_PRIORITY_CLASS\)/);
  assert.match(sharedEnvironment, /EnableEfficiencyModeForEnvironment\(readyEnvironment\.Get\(\)\)/);
});
