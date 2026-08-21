import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const composition = readFileSync(
  new URL('../../native/src/sh_track_boundary_script.h', import.meta.url),
  'utf8',
);
const policy = readFileSync(
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

function settlementSection() {
  return section(
    composition,
    'inline std::wstring StationheadLoginSettlementScript()',
    '// Media boundaries never initiate navigation.',
  );
}

test('current login settlement remains intact', () => {
  const settlement = settlementSection();
  assert.match(settlement, /stationhead-auth-ready/);
  assert.match(settlement, /document\.elementsFromPoint/);
  assert.match(settlement, /now - accountSince >= 3000/);
  assert.doesNotMatch(settlement, /window\.fetch|XMLHttpRequest/);
});

test('pre-368 credential capture is composed before login settlement', () => {
  assert.match(policy, /StationheadPre368AuthAndLoginSettlementScript/);
  assert.match(policy, /std::wstring script = StationheadAuthCaptureScript\(\)/);
  assert.match(policy, /homepanel-stationhead-auth-ready/);
  assert.match(policy, /script\.append\(StationheadLoginSettlementScript\(\)\)/);
  assert.match(
    policy,
    /#define StationheadAuthCaptureScript StationheadPre368AuthAndLoginSettlementScript/,
  );
});

test('embedded login settlement JavaScript parses independently', () => {
  const settlement = settlementSection();
  const raw = settlement.match(/LR"JS\(([\s\S]*?)\)JS"/);
  assert.ok(raw, 'missing Stationhead login settlement raw JavaScript');
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

test('auth-ready still clears the native login latch', () => {
  const authReadyAt = webview.indexOf(
    'if (type == L"stationhead-auth-ready") {',
  );
  assert.ok(authReadyAt >= 0);
  const authReadyHandler = webview.slice(authReadyAt, authReadyAt + 2200);
  assert.match(authReadyHandler, /loginRequired_ = false;/);
  assert.match(authReadyHandler, /status_\.loginRequired = false;/);
  assert.match(authReadyHandler, /nextTickAt_ = 0;/);
});
