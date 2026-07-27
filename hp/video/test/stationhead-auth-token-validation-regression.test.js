import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const navigationPolicy = readFileSync(
  new URL('../../native/src/sh_auth_navigation_policy_fix.h', import.meta.url),
  'utf8',
);
const validationPolicy = readFileSync(
  new URL('../../native/src/sh_auth_capture_validation_policy_fix.h', import.meta.url),
  'utf8',
);
const runtimePolicy = readFileSync(
  new URL('../../native/src/sh_runtime_policy_fix.h', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

function occurrences(source, fragment) {
  let count = 0;
  for (let at = source.indexOf(fragment); at >= 0; at = source.indexOf(fragment, at + 1)) {
    count += 1;
  }
  return count;
}

test('response-validated auth capture is compiled after auth navigation policy', () => {
  const timeoutMacroAt = navigationPolicy.indexOf(
    '#define kStationheadAuthControllerTimeoutMs',
  );
  const validationIncludeAt = navigationPolicy.indexOf(
    '#include "sh_auth_capture_validation_policy_fix.h"',
  );
  assert.ok(timeoutMacroAt >= 0 && timeoutMacroAt < validationIncludeAt);
  assert.match(
    validationPolicy,
    /std::wstring script = StationheadAuthCaptureScript\(\);/,
  );
  assert.match(
    validationPolicy,
    /#undef StationheadAuthCaptureScript[\s\S]*#define StationheadAuthCaptureScript[\s\\]+StationheadAuthCaptureScriptResponseValidated/,
  );
});

test('optimistic base auth-cache markers are replaced exactly once', () => {
  assert.equal(occurrences(runtimePolicy, 'rememberAcceptedAuthorization();'), 2);
  assert.equal(occurrences(runtimePolicy, 'releaseRejectedAuthorization('), 2);
  for (const marker of [
    'acceptanceHelpersReplaced',
    'fetchCaptureReplaced',
    'xhrCaptureReplaced',
  ]) {
    assert.match(validationPolicy, new RegExp(`const bool ${marker}`));
    assert.match(validationPolicy, new RegExp(`\\(void\\)${marker};`));
  }
});

test('fetch tokens are accepted only after a trusted Stationhead response', () => {
  const fixedFetch = section(
    validationPolicy,
    'static constexpr std::wstring_view kFetchCaptureFixed',
    'static constexpr std::wstring_view kXhrCapture',
  );
  assert.match(fixedFetch, /trustedStationheadRequest\(requestUrl\)/);
  assert.match(
    fixedFetch,
    /window\.URL && input instanceof window\.URL \? input\.href/,
  );
  assert.match(fixedFetch, /const result = currentFetch\(input, init\);/);
  assert.equal(occurrences(fixedFetch, 'currentFetch(input, init)'), 1);
  assert.match(fixedFetch, /typeof result\?\.then === 'function'/);
  assert.match(
    fixedFetch,
    /response => recordAuthorizationStatus\(candidate, response\?\.status\)/,
  );
  assert.doesNotMatch(fixedFetch, /rememberAcceptedAuthorization\(\);/);
  assert.doesNotMatch(fixedFetch, /releaseRejectedAuthorization/);
});

test('XHR tokens wait for loadend and preserve the original send result', () => {
  const fixedXhr = section(
    validationPolicy,
    'static constexpr std::wstring_view kXhrCaptureFixed',
    'const bool acceptanceHelpersReplaced',
  );
  assert.match(fixedXhr, /trustedStationheadRequest\(this\.__homepanelUrl\)/);
  assert.match(fixedXhr, /new Headers\(this\.__homepanelHeaders \|\| \{\}\)/);
  assert.match(
    fixedXhr,
    /addEventListener\('loadend',[\s\S]*recordAuthorizationStatus\(candidate, this\.status\)[\s\S]*\{ once: true \}/,
  );
  assert.match(fixedXhr, /return currentSend\.apply\(this, args\);/);
  assert.doesNotMatch(fixedXhr, /rememberAcceptedAuthorization\(\);/);
  assert.doesNotMatch(fixedXhr, /releaseRejectedAuthorization/);
});

test('401 cannot remain in the false-positive recovery cache', () => {
  const helpers = section(
    validationPolicy,
    'static constexpr std::wstring_view kAcceptanceHelpersFixed',
    'static constexpr std::wstring_view kFetchCapture',
  );
  assert.match(helpers, /parsed\.protocol === 'https:'/);
  assert.match(
    helpers,
    /targetHost === 'stationhead\.com'[\s\S]*targetHost\.endsWith\('\.stationhead\.com'\)/,
  );
  assert.match(
    helpers,
    /current\?\.authorization &&[\s\S]*current\.authorization !== candidate\.authorization[\s\S]*return;/,
  );
  assert.match(
    helpers,
    /LastAcceptedAuthHeaders\?\.authorization ===[\s\S]*authorization[\s\S]*LastAcceptedAuthHeaders = null;/,
  );
  assert.match(
    helpers,
    /status === 401[\s\S]*rejectAuthorization\(candidate\.authorization\)[\s\S]*status > 0[\s\S]*acceptAuthorizationCandidate\(candidate\)/,
  );
  assert.doesNotMatch(helpers, /status === 403/);
});
