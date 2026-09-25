import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');
const composition = source('sh_track_boundary_script.h');
const interaction = source('sh_runtime_interaction_script.h');
const recovery = source('sh_runtime_blank_recovery_script.h');
const lifecycle = source('sh_runtime_lifecycle_script.h');
const compact = source('sh_compact_runtime_script.h');
const july19Policy = source('sh_july19_stats_policy_fix.h');
const webview = source('sh_webview.cpp');

function section(text, start, end) {
  const startAt = text.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = text.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return text.slice(startAt, endAt);
}

function rawScript(text) {
  const raw = text.match(/LR"JS\(([\s\S]*?)\)JS"/);
  assert.ok(raw, 'missing Stationhead raw JavaScript fragment');
  return raw[1];
}

test('legacy login-settlement registration is inert', () => {
  const settlement = section(
    composition,
    'inline std::wstring StationheadLoginSettlementScript()',
    'inline std::wstring StationheadTrackBoundaryScript(',
  );
  assert.match(settlement, /return L"void 0;"/);
  assert.doesNotMatch(settlement, /setInterval|new\s+MutationObserver|elementsFromPoint/);
});

test('interaction runtime owns login-required and stable auth-ready edges', () => {
  assert.match(interaction, /const accountVisible = \(\) =>/);
  assert.match(interaction, /const blockingLogin = \\(authenticated, recoverableAction = false\\) =>/);
  assert.match(interaction, /postText\('login-required'\)/);
  assert.match(interaction, /post\(\{ type: 'stationhead-auth-ready', source: 'compact-runtime' \}\)/);
  assert.match(interaction, /authReadyTimer = nativeTimeout[\s\S]*3000/);
  assert.match(interaction, /if \(!authenticated \|\| lastBlocking === false \|\| authReadyTimer\) return;/);
  assert.doesNotMatch(interaction, /setInterval\s*\(|new\s+MutationObserver/);
});

test('real blocking auth surfaces beat stale account presentation without blocking music-connect recovery', () => {
  const blocking = section(
    interaction,
    'const blockingLogin = (authenticated, recoverableAction = false) => {',
    'const cancelAuthReady = () => {',
  );
  assert.match(blocking, /if \(loginRoute\(\)\) return true;/);
  assert.match(blocking, /if \(visible\(input\)\) return true;/);
  assert.doesNotMatch(blocking, /serviceConnectPattern/);
  assert.doesNotMatch(blocking, /querySelectorAll\("h1,h2,h3,\[role='heading'\]"\)/);
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

test('responsibility fragments assemble into one valid compact runtime', () => {
  const script = [interaction, recovery, lifecycle]
    .map(rawScript)
    .join('\n')
    .replaceAll('{{GLOBAL}}', '__homepanelPrimaryStationhead')
    .replaceAll('{{PREFIX}}', 'stationhead');
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(compact, /StationheadRuntimeInteractionFragment\(\)/);
  assert.match(compact, /StationheadRuntimeBlankRecoveryFragment\(\)/);
  assert.match(compact, /StationheadRuntimeLifecycleFragment\(\)/);
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
