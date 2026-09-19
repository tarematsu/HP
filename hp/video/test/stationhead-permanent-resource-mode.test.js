import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readNative = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const stationheadPolicy = readNative('sh_runtime_resource_filter_policy_fix.h');
const permanentMode = readNative('stationhead_permanent_resource_mode.h');
const environment = readNative('shared_webview_environment.cpp');

test('Stationhead playback always applies LOW memory and Windows Efficiency mode', () => {
  assert.match(stationheadPolicy, /#include "stationhead_permanent_resource_mode\.h"/);
  assert.match(
    stationheadPolicy,
    /ApplyStationheadPermanentWebViewResourceMode\(environment, webview\)/,
  );
  assert.match(
    permanentMode,
    /put_MemoryUsageTargetLevel\([\s\S]*COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/,
  );
  assert.match(permanentMode, /SetPriorityClass\(process, BELOW_NORMAL_PRIORITY_CLASS\)/);
  assert.match(
    permanentMode,
    /PROCESS_POWER_THROTTLING_EXECUTION_SPEED[\s\S]*SetProcessInformation\(process, ProcessPowerThrottling/,
  );
});

test('Chromium background throttling remains enabled for Stationhead', () => {
  assert.doesNotMatch(environment, /--disable-backgrounding-occluded-windows/);
  assert.doesNotMatch(environment, /--disable-renderer-backgrounding/);
  assert.doesNotMatch(environment, /--disable-background-timer-throttling/);
});
