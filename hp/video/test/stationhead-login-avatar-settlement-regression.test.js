import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');
const composition = source('sh_track_boundary_script.h');
const startup = source('sh_startup_script.h');
const july19Policy = source('sh_july19_stats_policy_fix.h');
const webview = source('sh_webview.cpp');

function section(text, start, end) {
  const startAt = text.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = text.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return text.slice(startAt, endAt);
}

const compactRuntime = () => section(
  startup,
  'inline std::wstring StationheadCompactRuntimeScript(',
  'inline std::wstring BuildStationheadStartupScript(',
);

test('legacy login-settlement registration is inert', () => {
  const settlement = section(
    composition,
    'inline std::wstring StationheadLoginSettlementScript()',
    'inline std::wstring StationheadTrackBoundaryScript(',
  );
  assert.match(settlement, /return L"void 0;"/);
  assert.doesNotMatch(settlement, /setInterval|new\s+MutationObserver|elementsFromPoint/);
});

test('compact runtime owns login-required and stable auth-ready edges', () => {
  const runtime = compactRuntime();
  assert.match(runtime, /const accountVisible = \(\) =>/);
  assert.match(runtime, /const blockingLogin = authenticated =>/);
  assert.match(runtime, /postText\('login-required'\)/);
  assert.match(runtime, /post\(\{ type: 'stationhead-auth-ready', source: 'compact-runtime' \}\)/);
  assert.match(runtime, /authReadyTimer = nativeTimeout[\s\S]*3000/);
  assert.match(runtime, /if \(!authenticated \|\| lastBlocking === false \|\| authReadyTimer\) return;/);
  assert.doesNotMatch(runtime, /setInterval\s*\(|new\s+MutationObserver/);
});

test('real blocking auth surfaces beat stale account presentation', () => {
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

test('July 19 credential capture remains before the inert settlement slot', () => {
  assert.match(july19Policy, /StationheadJuly19AuthCaptureScript/);
  assert.match(july19Policy, /window\.fetch = function\(input, init\)/);
  assert.match(july19Policy, /NativeXhr\.prototype\.send = function/);
  assert.match(july19Policy, /script\.append\(StationheadLoginSettlementScript\(\)\)/);
  assert.match(
    july19Policy,
    /#define StationheadAuthCaptureScript StationheadJuly19AuthAndLoginSettlementScript/,
  );
});

test('all compact runtime JavaScript chunks assemble into one valid script', () => {
  const chunks = [...compactRuntime().matchAll(/LR"JS\(([\s\S]*?)\)JS"/g)]
    .map(match => match[1]);
  assert.equal(chunks.length, 3);
  const script = chunks.join('\n')
    .replaceAll('{{GLOBAL}}', '__homepanelPrimaryStationhead')
    .replaceAll('{{PREFIX}}', 'stationhead');
  assert.doesNotThrow(() => new vm.Script(script));
});

test('auth capture registration still precedes startup runtime registration', () => {
  const authAt = webview.indexOf(
    'const HRESULT authCaptureResult = webview_->AddScriptToExecuteOnDocumentCreated(',
  );
  const startupAt = webview.indexOf(
    'const HRESULT startupScriptResult = webview_->AddScriptToExecuteOnDocumentCreated(',
  );
  assert.ok(authAt >= 0 && startupAt > authAt);
});

test('only auth-ready clears the native login latch', () => {
  const at = webview.indexOf('if (type == L"stationhead-auth-ready") {');
  assert.ok(at >= 0);
  const handler = webview.slice(at, at + 2200);
  assert.match(handler, /loginRequired_ = false;/);
  assert.match(handler, /status_\.loginRequired = false;/);
  assert.match(handler, /nextTickAt_ = 0;/);
});
