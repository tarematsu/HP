import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const native = file => readFileSync(
  new URL('../../native/src/' + file, import.meta.url), 'utf8');
const resourceHeaders = [
  'sh_polling_policy.h',
  'sh_runtime_resource_policy_fix.h',
  'sh_runtime_resource_boundary_policy_fix.h',
  'sh_runtime_resource_filter_policy_fix.h',
  'sh_runtime_script_resource_policy_fix.h',
];
const source = native('sh_webview.cpp');
const finalResource = native('sh_runtime_script_resource_policy_fix.h');

test('Stationhead resource setup has one explicit owner, not source-order PCH rewriting', () => {
  for (const header of resourceHeaders) {
    assert.doesNotMatch(native(header),
      /#(?:define|undef)\s+ApplyStationheadResourceBlocking\b/,
      header + ' must not rewrite the chosen callback');
  }
  assert.match(source, /#include "sh_runtime_script_resource_policy_fix\.h"/);
  assert.match(source,
    /ApplyStationheadResourceBlockingScriptFixed\(environment_\.Get\(\), webview_\.Get\(\), config_,/);
  assert.match(finalResource,
    /inline void ApplyStationheadResourceBlockingScriptFixed\(/);
  assert.equal((finalResource.match(/add_WebResourceRequested\(/g) || []).length, 1);
  for (const header of [
    'sh_shared.h', 'sh_polling_policy.h',
    'sh_script_blocking_extension.h', 'sh_runtime_resource_policy_fix.h',
    'sh_runtime_resource_boundary_policy_fix.h',
    'sh_runtime_resource_filter_policy_fix.h',
  ]) {
    assert.doesNotMatch(native(header), /add_WebResourceRequested\(/,
      header + ' is no longer authorized to register callbacks');
  }
});

test('resource callback exception protection and LOW memory mode have no PCH aliases', () => {
  const eventPolicy = native('sh_webview_event_policy.h');
  assert.doesNotMatch(eventPolicy, /#define add_WebResourceRequested\(/);
  assert.match(finalResource,
    /stationhead_webview_policy::WrapStationheadWebResourceRequestedHandler\(/);
  assert.match(finalResource,
    /ApplyStationheadPermanentWebViewResourceMode\(environment, webview\)/);
  assert.match(eventPolicy, /InvokeEventNoexcept\(inner, sender, args\)/);
});

test('profiled audio monitoring is not rewritten by PCH preprocessor aliases', () => {
  const scan = native('sh_playback_resource_policy_fix.h');
  const recovery = native('sh_track_boundary_message_policy.h');
  assert.doesNotMatch(scan,
    /#define (?:AudioHealthScanDelayMs|TryClaimAudioHealthScan|kAudioHealthScanRetryMs)\b/);
  assert.match(recovery, /StationheadProfileAudioHealthScanDelayMs\(GetTickCount64\(\), profileName_\)/);
  assert.match(recovery, /TryClaimAudioHealthScanSlot\(/);
  assert.match(recovery, /StationheadProfileAudioHealthRetryMs\(profileName_\)/);
  const poll = native('sh_polling_policy.h');
  assert.doesNotMatch(poll,
    /#define (?:StationheadAutoplayScript|StationheadVolumeScript)\b/);
  assert.match(native('sh_shared.h'), /StationheadAutoplayScriptBase\(/);
  assert.match(native('sh_shared.h'), /StationheadVolumeScriptWithMutationObserver\(/);
});


test('ten Stationhead COM event handlers are registered explicitly with preserved auth gates', () => {
  const eventPolicy = native('sh_webview_event_policy.h');
  for (const file of [
    'sh_webview_event_policy.h', 'sh_onboarding_click_policy.h',
    'sh_auth_navigation_policy_fix.h', 'sh_process_failure_policy_fix.h',
    'sh_auth_process_failure_policy_fix.h',
    'sh_auth_completion_message_policy_fix.h',
    'sh_stats_webview_message_policy_fix.h',
  ]) {
    assert.doesNotMatch(native(file),
      /#(?:define|undef)\s+add_(?:WebMessageReceived|NewWindowRequested|NavigationStarting|NavigationCompleted|ProcessFailed|WindowCloseRequested|IsDocumentPlayingAudioChanged)\b/,
      file + ' must not replace COM registration calls via the preprocessor');
  }
  const registered = [
    ['WrapStationheadAudioChangedHandler', 1],
    ['WrapStationheadNavigationStartingHandler', 1],
    ['WrapStationheadNewWindowHandler', 1],
    ['WrapStationheadWebMessageHandler', 2],
    ['WrapStationheadAuthCompletionMessageHandler', 2],
    ['WrapStationheadAuthStableNavigationCompletedHandler', 2],
    ['WrapStationheadAuthStableProcessFailedHandler', 2],
    ['WrapStationheadWindowCloseHandler', 1],
  ];
  for (const [wrapper, count] of registered) {
    assert.equal((source.match(new RegExp(wrapper + '\\(', 'g')) || []).length,
      count, wrapper + ' must be called directly on every applicable event');
  }
  assert.match(source,
    /WrapStationheadWebMessageHandler\(\s*stationhead_auth_completion_message_policy::WrapStationheadAuthCompletionMessageHandler\(/);
  assert.match(source, /#include "sh_webview_event_policy\.h"/);
  assert.match(eventPolicy, /InvokeEventNoexcept\(inner, sender, args\)/);
});
