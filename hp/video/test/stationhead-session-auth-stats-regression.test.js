import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_july19_stats_policy_fix.h', import.meta.url),
  'utf8',
);

test('streakStats can use the existing WebView cookie session without Authorization', () => {
  assert.match(policy, /const captured = window\.__homepanelStationheadAuthHeaders/);
  assert.match(policy, /const requestHeaders = \{ accept: 'application\/json' \}/);
  assert.match(
    policy,
    /if \(captured\?\.authorization\) Object\.assign\(requestHeaders, captured\)/,
  );
  assert.match(policy, /credentials: 'include'/);
  assert.match(policy, /headers: requestHeaders/);
  assert.doesNotMatch(policy, /error: 'no-auth-header'/);
});

test('401 invalidates a captured token but 403 leaves it available', () => {
  const unauthorizedAt = policy.indexOf('if (response.status === 401) {');
  const forbiddenAt = policy.indexOf('if (response.status === 403) {');
  assert.ok(unauthorizedAt >= 0);
  assert.ok(forbiddenAt > unauthorizedAt);

  const unauthorized = policy.slice(unauthorizedAt, forbiddenAt);
  assert.match(unauthorized, /__homepanelStationheadRejectedAuthorization/);
  assert.match(unauthorized, /__homepanelStationheadAuthHeaders = null/);
  assert.match(unauthorized, /stationhead-play-stats-auth-failed/);

  const forbidden = policy.slice(forbiddenAt, policy.indexOf('if (!response.ok)', forbiddenAt));
  assert.match(forbidden, /stationhead-play-stats-error/);
  assert.match(forbidden, /error: 'forbidden'/);
  assert.doesNotMatch(forbidden, /__homepanelStationheadRejectedAuthorization/);
  assert.doesNotMatch(forbidden, /__homepanelStationheadAuthHeaders = null/);
});

test('successful payload still uses the existing generationless native-store bridge', () => {
  assert.match(
    policy,
    /post\(\{ type: 'stationhead-play-stats', data, source: 'authenticated-api' \}\)/,
  );
  assert.match(policy, /#include "sh_stats_webview_message_policy_fix\.h"/);
  assert.doesNotMatch(policy, /auth_generation|document_generation|request_id/);
});
