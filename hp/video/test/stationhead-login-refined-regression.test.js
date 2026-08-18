import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtimeFixSource = readFileSync(
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

test('refined blocking-login detection invalidates captured auth independently', () => {
  const autoplay = section(
    runtimeFixSource,
    'inline std::wstring StationheadAutoplayScriptRuntimeFixed(',
    '// The page can complete a fresh login',
  );
  assert.match(autoplay, /const rejectCapturedAuthForBlockingLogin = \(\) =>/);
  assert.match(
    autoplay,
    /window\.__homepanelStationheadRejectedAuthorization = authorization/,
  );
  assert.match(autoplay, /window\.__homepanelStationheadAuthHeaders = null/);

  const blockingBranch = section(
    autoplay,
    'if (surface.blocking) {',
    'if (!loginMissingSince)',
  );
  const markBlockingAt = blockingBranch.indexOf(
    'window.__homepanelStationheadBlockingLoginVisible = true;',
  );
  const clearPendingAt = blockingBranch.indexOf('pendingAuthReady = null;');
  const rejectAt = blockingBranch.indexOf(
    'rejectCapturedAuthForBlockingLogin();',
  );
  const notifyAt = blockingBranch.indexOf('nativePost(loginMessage);');
  assert.ok(markBlockingAt >= 0 && markBlockingAt < clearPendingAt);
  assert.ok(clearPendingAt >= 0 && clearPendingAt < rejectAt);
  assert.ok(rejectAt >= 0 && rejectAt < notifyAt);
});

test('non-blocking login false positives restore the last accepted auth snapshot', () => {
  const autoplay = section(
    runtimeFixSource,
    'inline std::wstring StationheadAutoplayScriptRuntimeFixed(',
    '// The page can complete a fresh login',
  );
  assert.match(autoplay, /const restoreAuthAfterFalsePositive = \(\) =>/);
  assert.match(autoplay, /__homepanelStationheadLastAcceptedAuthHeaders/);
  assert.match(
    autoplay,
    /window\.__homepanelStationheadAuthHeaders = Object\.assign\(\{\}, last\)/,
  );
  assert.match(
    autoplay,
    /if \(!updateBlockingLogin\(\)\) restoreAuthAfterFalsePositive\(\)/,
  );
});

test('auth-ready waits for a stably cleared blocking login surface', () => {
  const autoplay = section(
    runtimeFixSource,
    'inline std::wstring StationheadAutoplayScriptRuntimeFixed(',
    '// The page can complete a fresh login',
  );
  assert.match(autoplay, /let pendingAuthReady = null;/);

  const flushPending = section(
    autoplay,
    'const flushPendingAuthReady = () => {',
    'if (webview && nativePost)',
  );
  assert.match(
    flushPending,
    /window\.__homepanelStationheadBlockingLoginVisible !== false/,
  );
  assert.match(flushPending, /pendingAuthReady = null;/);
  assert.match(flushPending, /nativePost\?\.\(message\);/);

  const authReadyHandler = section(
    autoplay,
    "message.type === 'stationhead-auth-ready') {",
    'return nativePost(message);',
  );
  assert.match(authReadyHandler, /pendingAuthReady = message;/);
  assert.match(
    authReadyHandler,
    /updateBlockingLogin\(\);[\s\S]*flushPendingAuthReady\(\);/,
  );
  assert.match(
    autoplay,
    /updateBlockingLogin\(\);\s*flushPendingAuthReady\(\);\s*}\s*schedule\(\);/,
  );
});
