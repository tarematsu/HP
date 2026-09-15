import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');
const interaction = source('sh_runtime_interaction_script.h');
const reuse = source('sh_auth_capture_reuse_policy.h');
const validation = source('sh_auth_capture_validation_policy_fix.h');

function section(text, start, end) {
  const startAt = text.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = text.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return text.slice(startAt, endAt);
}

test('blocking-login detection invalidates captured auth before native notification', () => {
  const blocking = section(
    interaction,
    'if (blocking) {',
    'if (!authenticated || lastBlocking === false || authReadyTimer) return;',
  );
  const rejectedAt = blocking.indexOf(
    'window.__homepanelStationheadRejectedAuthorization = authorization;',
  );
  const clearAt = blocking.indexOf(
    'window.__homepanelStationheadAuthHeaders = null;',
  );
  const notifyAt = blocking.indexOf("postText('login-required');");
  assert.ok(rejectedAt >= 0 && rejectedAt < clearAt);
  assert.ok(clearAt >= 0 && clearAt < notifyAt);
  assert.match(blocking, /homepanelStationheadBlockingLoginVisible = true/);
});

test('same-token reuse is gated by the cleared blocking-login state', () => {
  const release = section(
    reuse,
    'const releaseRejectedAuthorization = authorization => {',
    'const currentFetch = window.fetch',
  );
  assert.match(release, /authorization !== window\.__homepanelStationheadRejectedAuthorization/);
  assert.match(release, /window\.__homepanelStationheadBlockingLoginVisible !== false/);
  assert.match(release, /window\.__homepanelStationheadRejectedAuthorization = null/);
});

test('auth-ready requires a three-second stable non-blocking surface', () => {
  const ready = section(
    interaction,
    'const publishAuth = () => {',
    '}  // namespace hp',
  );
  assert.match(ready, /authReadyTimer = nativeTimeout/);
  assert.match(ready, /3000/);
  assert.match(ready, /const stillAuthenticated = accountVisible\(\) \|\| playing\(\)/);
  assert.match(ready, /blockingLogin\(stillAuthenticated\)/);
  assert.match(ready, /homepanelStationheadBlockingLoginVisible = false/);
  assert.match(ready, /stationhead-auth-ready/);
});

test('response validation remains the final authority for reusable auth', () => {
  assert.match(validation, /trustedStationheadRequest/);
  assert.match(validation, /recordAuthorizationStatus/);
  assert.match(validation, /status === 401/);
  assert.match(validation, /rejectAuthorization\(candidate\.authorization\)/);
  assert.match(validation, /status > 0/);
  assert.match(validation, /acceptAuthorizationCandidate\(candidate\)/);
});
