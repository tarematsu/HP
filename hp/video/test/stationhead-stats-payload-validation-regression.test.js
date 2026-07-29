import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const navigationPolicy = readFileSync(
  new URL('../../native/src/sh_auth_navigation_policy_fix.h', import.meta.url),
  'utf8',
);
const payloadPolicy = readFileSync(
  new URL('../../native/src/sh_stats_payload_policy_fix.h', import.meta.url),
  'utf8',
);
const runtimePolicy = readFileSync(
  new URL('../../native/src/sh_runtime_policy_fix.h', import.meta.url),
  'utf8',
);

function includeOffset(name) {
  return navigationPolicy.indexOf(`#include "${name}"`);
}

test('stats payload validation is the final stats wrapper after auth fallback', () => {
  const fallbackAt = includeOffset('sh_stats_auth_fallback_policy_fix.h');
  const payloadAt = includeOffset('sh_stats_payload_policy_fix.h');
  const interactiveAt = includeOffset('sh_auth_interactive_memory_policy_fix.h');
  assert.ok(fallbackAt >= 0 && fallbackAt < payloadAt);
  assert.ok(payloadAt < interactiveAt);
  assert.match(
    payloadPolicy,
    /#undef StationheadApiPlayStatsScript[\s\S]*#define StationheadApiPlayStatsScript[\s\\]+StationheadApiPlayStatsScriptPayloadValidated/,
  );
});

test('malformed HTTP 200 payloads never arm the success throttle', () => {
  assert.match(payloadPolicy, /if \(!chartData\.length\) \{[\s\S]*resetSuccessThrottle\(\);/);
  assert.match(payloadPolicy, /error: 'invalid-payload:' \+ \(keys \|\| 'no-keys'\)/);
  const invalidAt = payloadPolicy.indexOf('if (!chartData.length)');
  const successAt = payloadPolicy.indexOf(
    'window.__homepanelStationheadPlayStatsSuccessAt = Date.now();',
    invalidAt,
  );
  assert.ok(invalidAt >= 0 && successAt > invalidAt);
});

test('compatible chart shapes and scalar representations are normalized', () => {
  for (const token of [
    'data?.chart_data',
    'data?.data?.chart_data',
    'data?.chartData',
    'data?.data?.chartData',
    'point?.ts ?? point?.timestamp ?? point?.date',
    'point?.val ?? point?.value ?? point?.count',
    "Date.parse(String(rawTimestamp || ''))",
    'timestamp < 10_000_000_000',
    "data: { chart_data: chartData }",
  ]) {
    assert.ok(payloadPolicy.includes(token), `missing normalization contract: ${token}`);
  }
});

test('payload wrapper replaces the exact unchecked runtime success block', () => {
  const marker = `  }).then(data => {\n    if (data) {\n      window.__homepanelStationheadPlayStatsSuccessAt = Date.now();\n      window.__homepanelStationheadPlayStatsAuthorization = headers.authorization;\n      post({ type: 'stationhead-play-stats', data, source: 'authenticated-api' });\n    }\n  }).catch(error => {\n`;
  assert.equal(runtimePolicy.split(marker).length - 1, 1);
  assert.match(
    payloadPolicy,
    /ReplaceStationheadRuntimeFragment\([\s\S]*kUncheckedSuccess,[\s\S]*kValidatedSuccess\)/,
  );
});
