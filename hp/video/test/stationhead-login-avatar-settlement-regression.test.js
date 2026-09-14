import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const composition = readFileSync(
  new URL('../../native/src/sh_track_boundary_script.h', import.meta.url),
  'utf8',
);
const startup = readFileSync(
  new URL('../../native/src/sh_startup_script.h', import.meta.url),
  'utf8',
);
const july19Policy = readFileSync(
  new URL('../../native/src/sh_july19_stats_policy_fix.h', import.meta.url),
  'utf8',
);
const webview = readFileSync(
  new URL('../../native/src/sh_webview.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

function compactRuntime() {
  return section(
    startup,
    'inline std::wstring StationheadCompactRuntimeScript(',
    'inline std::wstring BuildStationheadStartupScript(',
  );
}

test('legacy login-settlement registration is now a no-op', () => {
  const settlement = section(
    composition,
    'inline std::wstring StationheadLoginSettlementScript()',
    'inline std::wstring StationheadTrackBoundaryScript(',
  );
  assert.match(settlement, /return L"void 0;"/);
  assert.doesNotMatch(settlement, /setInterval|MutationObserver|elementsFromPoint/);
});

test('compact runtime owns both login-required and stable auth-ready edges', () => {
  const runtime = compactRuntime();
  assert.match(runtime, /const accountVisible = \(\) =>/);
  assert.match(runtime, /const blockingLogin = authenticated =>/);
  assert.match(runtime, /postText\('login-required'\)/);
  assert.match(runtime, /post\(\{ type: 'stationhead-auth-ready', source: 'compact-runtime' \}\)/);
  assert.match(runtime, /authReadyTimer = nativeTimeout[\s\S]*3000/);
  assert.match(runtime, /if \(!authenticated \|\| lastBlocking === false \|\| authReadyTimer\) return;/);
  assert.doesNotMatch(runtime, /setInterval\s*\(/);
  assert.doesNotMatch(runtime, /MutationObserver/);
});

test('real blocking authentication surfaces beat stale account presentation', () => {
  const runtime = compactRuntime();
  const blocking = section(
    runtime,
    'const blockingLogin = authenticated => {',
    'const cancelAuthReady = () => {',
  );
  assert.match(blocking, /if \(loginRoute\(\)\) return true;/);
  assert.match(blocking, /if \(visible\(input\)\) return true;/);
  assert.match(blocking, /serviceConnectPattern\.test\(labelOf\(heading\)\)/);
  assert.match(blocking, /element\.closest\?\.\(blockingShellSelector\)/);
  assert.match(blocking, /if \(!authenticated \|\| \(shell && visible\(shell\)\)\) return true;/);
});

test('July 19 credential capture remains composed before the no-op settlement slot', () => {
  assert.match(july19Policy, /StationheadJuly19AuthCaptureScript/);
  assert.match(july19Policy, /window\.fetch = function\(input, init\)/);
  assert.match(july19Policy, /NativeXhr\.prototype\.send = function/);
  assert.match(
    july19Policy,
    /std::wstring script = StationheadJuly19AuthCaptureScript\(\)/,
  );
  assert.match(
    july19Policy,
    /script\.append\(StationheadLoginSettlementScript\(\)\)/,
  );
  assert.match(
    july19Policy,
    /#define StationheadAuthCaptureScript StationheadJuly19AuthAndLoginSettlementScript/,
  );
});

test('compact document runtime JavaScript parses independently', () => {
  const runtime = compactRuntime();
  const raw = runtime.match(/LR"JS\(([\s\S]*?)\)JS"/);
  assert.ok(raw, 'missing compact Stationhead runtime raw JavaScript');
  assert.doesNotThrow(() => new vm.Script(raw[1]));
});

test('document-start registration still occurs before startup script', () => {
  const firstRegistration = webview.indexOf(
    'const HRESULT authCaptureResult = webview_->AddScriptToExecuteOnDocumentCreated(',
  );
  const startupRegistration = webview.indexOf(
    'const HRESULT startupScriptResult = webview_->AddScriptToExecuteOnDocumentCreated(',
  );
  assert.ok(firstRegistration >= 0);
  assert.ok(startupRegistration > firstRegistration);
});

test('only auth-ready clears the native login latch', () => {
  const authReadyAt = webview.indexOf(
    'if (type == L"stationhead-auth-ready") {',
  );
  assert.ok(authReadyAt >= 0);
  const authReadyHandler = webview.slice(authReadyAt, authReadyAt + 2200);
  assert.match(authReadyHandler, /loginRequired_ = false;/);
  assert.match(authReadyHandler, /status_\.loginRequired = false;/);
  assert.match(authReadyHandler, /nextTickAt_ = 0;/);
});
