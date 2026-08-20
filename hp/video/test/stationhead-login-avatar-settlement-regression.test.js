import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const composition = readFileSync(
  new URL('../../native/src/sh_track_boundary_script.h', import.meta.url),
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

function settlementSection() {
  return section(
    composition,
    'inline std::wstring StationheadLoginSettlementScript()',
    '// Restore only the proven session-local credential observation',
  );
}

test('first document-start slot combines auth capture with login settlement', () => {
  const settlement = settlementSection();

  assert.match(
    composition,
    /#define StationheadAuthCaptureScript StationheadAuthAndLoginSettlementScript/,
  );
  assert.match(
    composition,
    /std::wstring script = StationheadAuthCaptureScript\(\)/,
  );
  assert.match(
    composition,
    /script\.append\(StationheadLoginSettlementScript\(\)\)/,
  );
  assert.doesNotMatch(settlement, /window\.fetch|XMLHttpRequest|MutationObserver/);
  assert.doesNotMatch(settlement, /Connect\s+music|connectMusic|serviceConnect/);

  const firstRegistration = webview.indexOf(
    'const HRESULT authCaptureResult = webview_->AddScriptToExecuteOnDocumentCreated(',
  );
  const startupRegistration = webview.indexOf(
    'const HRESULT startupScriptResult = webview_->AddScriptToExecuteOnDocumentCreated(',
  );
  assert.ok(firstRegistration >= 0);
  assert.ok(startupRegistration > firstRegistration);
});

test('embedded login settlement JavaScript parses independently', () => {
  const settlement = settlementSection();
  const raw = settlement.match(/LR"JS\(([\s\S]*?)\)JS"/);
  assert.ok(raw, 'missing Stationhead login settlement raw JavaScript');
  assert.doesNotThrow(() => new vm.Script(raw[1]));
});

test('login settlement captures the original WebView2 native bridge before startup wrappers', () => {
  const settlement = settlementSection();

  assert.match(settlement, /webview\.postMessage\.bind\(webview\)/);
  assert.match(settlement, /nativePost\(\{ type: 'stationhead-auth-ready' \}\)/);
  assert.doesNotMatch(settlement, /webview\.postMessage\s*=/);
});

test('top-right account control is resolved from the exact Stationhead menu slot', () => {
  const settlement = settlementSection();

  assert.match(settlement, /document\.elementsFromPoint/);
  assert.match(settlement, /innerWidth - 24/);
  assert.match(settlement, /innerWidth - 32/);
  assert.match(settlement, /innerWidth - 40/);
  assert.match(settlement, /rect\.right < innerWidth - 96/);
  assert.match(settlement, /rect\.top > 96/);
  assert.match(settlement, /\^menu\$/);
  assert.match(settlement, /element\.matches\?\.\('img,picture'\)/);
  assert.match(settlement, /data-testid\*='avatar'/);
  assert.match(settlement, /class\*='avatar'/);
  assert.match(settlement, /account\|profile\|avatar/);
  assert.match(settlement, /style\.backgroundImage/);
  assert.doesNotMatch(settlement, /naturalWidth|naturalHeight|\.complete/);
});

test('only a stable signed-in account slot clears the native login latch', () => {
  const settlement = settlementSection();

  assert.match(settlement, /const visibleLoginSurface = \(\) =>/);
  assert.match(settlement, /credentialSelector/);
  assert.match(settlement, /loginPattern\.test\(label\)/);
  assert.match(settlement, /if \(visibleLoginSurface\(\)\)/);
  assert.match(settlement, /now - accountSince >= 3000/);

  const authReadyAt = webview.indexOf(
    'if (type == L"stationhead-auth-ready") {',
  );
  assert.ok(authReadyAt >= 0);
  const authReadyHandler = webview.slice(authReadyAt, authReadyAt + 1800);
  assert.match(authReadyHandler, /loginRequired_ = false;/);
  assert.match(authReadyHandler, /status_\.loginRequired = false;/);
  assert.match(authReadyHandler, /nextTickAt_ = 0;/);
  assert.match(authReadyHandler, /PostChange\(\);/);
});

test('settlement loop is bounded and lifecycle-aware without a DOM observer', () => {
  const settlement = settlementSection();

  assert.match(settlement, /const schedule = \(delay = 1000\) =>/);
  assert.match(settlement, /pagehide/);
  assert.match(settlement, /pageshow/);
  assert.match(settlement, /DOMContentLoaded/);
  assert.match(settlement, /nativeClearTimeout\(timer\)/);
  assert.doesNotMatch(settlement, /setInterval|MutationObserver/);
});
