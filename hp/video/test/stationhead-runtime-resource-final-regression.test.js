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

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('final resource policy is compiled after every earlier Stationhead policy', () => {
  assert.match(
    cmakeSource,
    /set\(HOMEPANEL_STATIONHEAD_SOURCES[\s\S]*src\/sh_polling_policy\.h[\s\S]*src\/sh_runtime_policy_fix\.h[\s\S]*src\/sh_runtime_resource_policy_fix\.h/,
  );
  assert.match(
    cmakeSource,
    /target_precompile_headers\(HomePanel PRIVATE[\s\S]*src\/sh_polling_policy\.h[\s\S]*src\/sh_runtime_policy_fix\.h[\s\S]*src\/sh_runtime_resource_policy_fix\.h\)/,
  );
  assert.match(
    finalPolicySource,
    /#undef ApplyStationheadResourceBlocking[\s\S]*#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingFinalFixed/,
  );
});

test('legacy blank recovery is not registered by final resource setup', () => {
  const additional = section(
    finalPolicySource,
    'inline void ApplyStationheadAdditionalScriptBlockingRuntimeFixed(',
    '// Final resource policy.',
  );
  assert.doesNotMatch(additional, /StationheadBlankPageRecoveryScript/);
  assert.doesNotMatch(additional, /AddScriptToExecuteOnDocumentCreated/);
  assert.match(additional, /StationheadAdditionalNonPlaybackScriptUrl\(uriLower\)/);

  const finalPolicy = section(
    finalPolicySource,
    'inline void ApplyStationheadResourceBlockingFinalFixed(',
    '}  // namespace hp',
  );
  assert.match(
    finalPolicy,
    /ApplyStationheadAdditionalScriptBlockingRuntimeFixed\(environment, webview\)/,
  );
  assert.doesNotMatch(
    finalPolicy,
    /ApplyStationheadAdditionalScriptBlocking\(environment, webview\)/,
  );
});

test('final resource callbacks own only COM and immutable configuration state', () => {
  const finalPolicy = section(
    finalPolicySource,
    'inline void ApplyStationheadResourceBlockingFinalFixed(',
    '}  // namespace hp',
  );
  assert.match(finalPolicy, /\(void\)armed;/);
  assert.match(finalPolicy, /\[env, blockImages, blockFonts\]/);
  assert.doesNotMatch(finalPolicy, /&armed/);
  assert.match(finalPolicy, /StationheadRequestIsBlockable\(lower\)/);
  assert.match(finalPolicy, /StationheadCorePlaybackRequest\(lower\)/);
  assert.match(finalPolicy, /BlockStationheadTelemetrySockets\(webview, config\.blockImages\)/);
});
