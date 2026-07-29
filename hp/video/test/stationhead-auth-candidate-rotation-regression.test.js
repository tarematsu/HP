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
const rotationPolicy = readFileSync(
  new URL('../../native/src/sh_auth_candidate_rotation_policy_fix.h', import.meta.url),
  'utf8',
);

function occurrences(source, fragment) {
  return source.split(fragment).length - 1;
}

test('validated candidate rotation is compiled before the stats fallback', () => {
  const validationAt = navigationPolicy.indexOf(
    '#include "sh_auth_capture_validation_policy_fix.h"',
  );
  const rotationAt = navigationPolicy.indexOf(
    '#include "sh_auth_candidate_rotation_policy_fix.h"',
  );
  const fallbackAt = navigationPolicy.indexOf(
    '#include "sh_stats_auth_fallback_policy_fix.h"',
  );
  assert.ok(validationAt >= 0 && validationAt < rotationAt);
  assert.ok(rotationAt < fallbackAt);
  assert.match(
    rotationPolicy,
    /#undef StationheadAuthCaptureScript[\s\S]*#define StationheadAuthCaptureScript[\s\\]+StationheadAuthCaptureScriptValidatedRotation/,
  );
});

test('the exact first-candidate pin is replaced once', () => {
  const pin = `    const current = window.__homepanelStationheadAuthHeaders;\n    if (current?.authorization &&\n        current.authorization !== candidate.authorization) {\n      return;\n    }\n`;
  assert.equal(occurrences(validationPolicy, pin), 1);
  assert.ok(rotationPolicy.includes(pin));
  assert.match(
    rotationPolicy,
    /ReplaceStationheadRuntimeFragment\([\s\S]*kPinnedCandidatePolicy,[\s\S]*kRotatingCandidatePolicy\)/,
  );
});

test('newer successful candidates supersede older account contexts safely', () => {
  let acceptedOrder = 0;
  let current = null;
  const accept = candidate => {
    if (candidate.order > 0 && candidate.order < acceptedOrder) return;
    acceptedOrder = Math.max(acceptedOrder, candidate.order);
    current = candidate.authorization;
  };

  const earlyAnonymousContext = { order: 1, authorization: 'Bearer early' };
  const accountScopedContext = { order: 2, authorization: 'Bearer account' };

  accept(earlyAnonymousContext);
  assert.equal(current, 'Bearer early');
  accept(accountScopedContext);
  assert.equal(current, 'Bearer account');
  accept(earlyAnonymousContext); // delayed response from the older request
  assert.equal(current, 'Bearer account');
});

test('rotation metadata cannot leak into Stationhead request headers', () => {
  assert.match(rotationPolicy, /const candidateOrders = new WeakMap\(\);/);
  assert.match(rotationPolicy, /candidateOrders\.set\(candidate, \+\+nextCandidateOrder\);/);
  assert.match(rotationPolicy, /candidateOrders\.get\(candidate\)/);
  assert.doesNotMatch(rotationPolicy, /candidate\.__homepanelCaptureOrder\s*=/);
});

test('explicit 401 rejection and blocking-login gate remain intact', () => {
  assert.match(
    validationPolicy,
    /status === 401[\s\S]*rejectAuthorization\(candidate\.authorization\)/,
  );
  assert.match(
    rotationPolicy,
    /RejectedAuthorization ===[\s\S]*candidate\.authorization[\s\S]*BlockingLoginVisible !== false[\s\S]*return;/,
  );
});
