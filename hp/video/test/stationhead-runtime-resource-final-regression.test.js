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

test('final resource policy is compiled after focused Stationhead interaction/auth policies', () => {
  assert.match(
    cmakeSource,
    /set\(HOMEPANEL_STATIONHEAD_SOURCES[\s\S]*src\/sh_polling_policy\.h[\s\S]*src\/sh_start_button_locator_policy\.h[\s\S]*src\/sh_auth_capture_reuse_policy\.h[\s\S]*src\/sh_auth_capture_origin_policy\.h[\s\S]*src\/sh_runtime_resource_policy_fix\.h/,
  );
  const pch = section(
    cmakeSource,
    'target_precompile_headers(HomePanel PRIVATE',
    'add_dependencies(HomePanel',
  );
  const basePchAt = pch.indexOf('src/sh_polling_policy.h');
  const finalPchAt = pch.indexOf('src/sh_runtime_resource_policy_fix.h');
  assert.ok(basePchAt >= 0 && basePchAt < finalPchAt);
  assert.doesNotMatch(cmakeSource, /sh_runtime_policy_fix\.h/);
  assert.match(
    finalPolicySource,
    /#undef ApplyStationheadResourceBlocking[\s\S]*#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingFinalFixed/,
  );
});

test('final resource setup does not register blank-page recovery', () => {
  const finalPolicy = section(
    finalPolicySource,
    'inline void ApplyStationheadResourceBlockingFinalFixed(',
    '}  // namespace hp',
  );
  assert.doesNotMatch(finalPolicy, /StationheadBlankPageRecoveryScript/);
  assert.doesNotMatch(finalPolicy, /AddScriptToExecuteOnDocumentCreated/);
  assert.match(
    finalPolicy,
    /StationheadAdditionalNonPlaybackScriptUrl\(lower\)/,
  );
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

test('script blocking is consolidated into the single final callback', () => {
  const finalPolicy = section(
    finalPolicySource,
    'inline void ApplyStationheadResourceBlockingFinalFixed(',
    '}  // namespace hp',
  );
  assert.equal(
    (finalPolicy.match(/add_WebResourceRequested\(/g) || []).length,
    1,
  );
  assert.match(
    finalPolicy,
    /context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT[\s\S]*StationheadNonPlaybackScriptUrlRuntimeFixed\(lower\)[\s\S]*StationheadAdditionalNonPlaybackScriptUrl\(lower\)/,
  );
  assert.doesNotMatch(
    finalPolicySource,
    /ApplyStationheadNonPlaybackScriptBlockingRuntimeFixed/,
  );
  assert.doesNotMatch(
    finalPolicySource,
    /ApplyStationheadAdditionalScriptBlockingRuntimeFixed/,
  );
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
