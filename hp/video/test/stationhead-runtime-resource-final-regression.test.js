import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cmakeSource = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url),
  'utf8',
);
const finalPolicySource = readFileSync(
  new URL('../../native/src/sh_runtime_resource_policy_fix.h', import.meta.url),
  'utf8',
);
const webviewSource = readFileSync(new URL('../../native/src/sh_webview.cpp', import.meta.url), 'utf8');
const activePolicySource = readFileSync(
  new URL('../../native/src/sh_runtime_script_resource_policy_fix.h', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('Stationhead policy selection is an explicit direct call, not a PCH macro overlay', () => {
  assert.match(cmakeSource, /src\/sh_runtime_script_resource_policy_fix\.h/);
  assert.match(webviewSource, /#include "sh_runtime_script_resource_policy_fix\.h"/);
  assert.match(webviewSource,
    /ApplyStationheadResourceBlockingScriptFixed\(environment_\.Get\(\), webview_\.Get\(\), config_,/);
  assert.doesNotMatch(finalPolicySource, /#(?:define|undef) ApplyStationheadResourceBlocking/);
  assert.doesNotMatch(activePolicySource, /#(?:define|undef) ApplyStationheadResourceBlocking/);
  assert.doesNotMatch(finalPolicySource, /inline void ApplyStationheadResourceBlockingFinalFixed\(/);
});

test('active resource setup does not register blank-page recovery', () => {
  const active = section(activePolicySource,
    'inline void ApplyStationheadResourceBlockingScriptFixed(', '}  // namespace hp');
  assert.doesNotMatch(active, /StationheadBlankPageRecoveryScript/);
  assert.doesNotMatch(active, /AddScriptToExecuteOnDocumentCreated/);
  assert.match(active, /StationheadExpandedNonPlaybackScriptBoundaryFixed\(lower\)/);
});

test('non-playback scripts are matched only on HTTPS Stationhead paths', () => {
  const predicate = section(
    finalPolicySource,
    'inline constexpr bool StationheadNonPlaybackScriptUrlRuntimeFixed(',
    '// Final resource policy.',
  );
  assert.match(predicate, /StationheadRuntimeScriptPath\(uriLower\)/);
  assert.match(predicate, /path\.ends_with\(L"\.js"\)/);
  assert.match(predicate, /path\.find\(needle\)/);
  assert.doesNotMatch(predicate, /uriLower\.find\(needle\)/);

  assert.match(
    finalPolicySource,
    /uriLower\.substr\(0, schemeEnd\) != L"https"/,
  );
  assert.match(
    finalPolicySource,
    /authority == L"stationhead\.com" \|\|[\s\S]*authority\.ends_with\(L"\.stationhead\.com"\)/,
  );
  assert.match(
    finalPolicySource,
    /https:\/\/chat-cdn\.stationhead\.com\/assets\/player-runtime-a1b2\.js/,
  );
  assert.match(
    finalPolicySource,
    /https:\/\/cdn\.example\.com\/assets\/chat-panel-a1b2\.js/,
  );
});

test('obsolete resource callback implementations are retired while active interception stays single', () => {
  const active = section(activePolicySource,
    'inline void ApplyStationheadResourceBlockingScriptFixed(', '}  // namespace hp');
  assert.equal((active.match(/add_WebResourceRequested\(/g) || []).length, 1);
  assert.match(active,
    /context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT[\s\S]*StationheadKnownOptionalModuleStubBoundaryFixed\(lower\)/);
  assert.match(active, /StationheadExpandedNonPlaybackScriptBoundaryFixed\(lower\)/);
  assert.match(active, /StationheadRequestIsBlockableBoundaryFixed\(lower\)/);
  assert.match(active, /StationheadCorePlaybackRequestBoundaryFixed\(lower\)/);
  assert.doesNotMatch(finalPolicySource, /inline void ApplyStationheadResourceBlockingFinalFixed\(/);
});

test('active Stationhead resource layer leaves UDF-owned image/font suppression alone', () => {
  const activePolicy = section(
    activePolicySource,
    'inline void ApplyStationheadResourceBlockingScriptFixed(',
    '}  // namespace hp',
  );
  assert.doesNotMatch(activePolicy, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_(?:IMAGE|FONT)/);
  assert.doesNotMatch(activePolicy, /StationheadRequestLooksLikeImage/);
  assert.match(activePolicy, /StationheadCorePlaybackRequestBoundaryFixed\(lower\)/);
  assert.match(activePolicy, /BlockStationheadTelemetrySocketsBoundaryFixed\(webview\)/);
});
