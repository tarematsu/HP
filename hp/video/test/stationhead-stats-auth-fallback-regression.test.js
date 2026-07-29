import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const navigationPolicy = readFileSync(
  new URL('../../native/src/sh_auth_navigation_policy_fix.h', import.meta.url),
  'utf8',
);
const fallbackPolicy = readFileSync(
  new URL('../../native/src/sh_stats_auth_fallback_policy_fix.h', import.meta.url),
  'utf8',
);
const runtimePolicy = readFileSync(
  new URL('../../native/src/sh_runtime_policy_fix.h', import.meta.url),
  'utf8',
);
const validationPolicy = readFileSync(
  new URL('../../native/src/sh_auth_capture_validation_policy_fix.h', import.meta.url),
  'utf8',
);

function occurrences(source, fragment) {
  let count = 0;
  for (let at = source.indexOf(fragment); at >= 0; at = source.indexOf(fragment, at + 1)) {
    count += 1;
  }
  return count;
}

test('play stats fallback is compiled after response-validated auth capture', () => {
  const validationAt = navigationPolicy.indexOf(
    '#include "sh_auth_capture_validation_policy_fix.h"',
  );
  const fallbackAt = navigationPolicy.indexOf(
    '#include "sh_stats_auth_fallback_policy_fix.h"',
  );
  assert.ok(validationAt >= 0 && validationAt < fallbackAt);
});

test('play stats prefer current headers and fall back only to accepted headers', () => {
  assert.match(
    fallbackPolicy,
    /std::wstring script = StationheadApiPlayStatsScript\(channelId\);/,
  );
  assert.match(
    fallbackPolicy,
    /const currentHeaders = window\.__homepanelStationheadAuthHeaders;/,
  );
  assert.match(
    fallbackPolicy,
    /const acceptedHeaders = window\.__homepanelStationheadLastAcceptedAuthHeaders;/,
  );
  assert.match(
    fallbackPolicy,
    /const headers = currentHeaders\?\.authorization \? currentHeaders : acceptedHeaders;/,
  );
  assert.doesNotMatch(fallbackPolicy, /RejectedAuthorization/);
});

test('the wrapper replaces the one current-header-only stats marker', () => {
  const marker = 'const headers = window.__homepanelStationheadAuthHeaders;';
  assert.equal(occurrences(runtimePolicy, marker), 1);
  assert.match(
    fallbackPolicy,
    /ReplaceStationheadRuntimeFragment\([\s\S]*kCurrentHeadersOnly,[\s\S]*kAcceptedHeadersFallback\)/,
  );
  assert.match(
    fallbackPolicy,
    /#undef StationheadApiPlayStatsScript[\s\S]*#define StationheadApiPlayStatsScript[\s\\]+StationheadApiPlayStatsScriptAcceptedAuthFallback/,
  );
});

test('an explicit 401 still invalidates the accepted fallback', () => {
  assert.match(
    validationPolicy,
    /status === 401[\s\S]*rejectAuthorization\(candidate\.authorization\)/,
  );
  assert.match(
    validationPolicy,
    /LastAcceptedAuthHeaders\?\.authorization ===[\s\S]*authorization[\s\S]*LastAcceptedAuthHeaders = null;/,
  );
});
