import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const source = read('../../native/src/renderer_panels/media_youtube_control_recovery.inc');
const base = read('../../native/src/renderer_panels/media_section_base.inc');
const host = read('../../native/src/renderer_panels/media_host.inc');
const fragments = [...source.matchAll(/LR"JS\(([\s\S]*?)\)JS"/g)];
const scripts = fragments.map(([, body]) => body);
// The final raw string is the compact dispatcher; previous parts are
// a single C++-concatenated JavaScript bootstrap script.
const full = scripts.slice(0, -1).join('');
const call = scripts.at(-1);

function environment(path = '/watch') {
  const calls = { queries: 0, timers: 0, messages: [], stateReads: 0, stateWrites: 0 };
  const location = { hostname: 'www.youtube.com', pathname: path };
  const window = { chrome: { webview: { postMessage: x => calls.messages.push(x) } } };
  let runtime;
  Object.defineProperty(window, '__homePanelYoutubeRuntime', {
    get() { calls.stateReads++; return runtime; },
    set(value) { calls.stateWrites++; runtime = value; },
    configurable: true,
  });
  const document = {
    querySelector: selector => {
      assert.equal(selector, '#movie_player');
      calls.queries++;
      return null;
    },
  };
  const context = vm.createContext({
    location, window, document,
    Date: class extends Date { static now() { return 1000; } },
    setTimeout: () => ++calls.timers,
    clearTimeout: () => {},
  });
  return {
    calls, window, location,
    inject: () => vm.runInContext(full, context),
    invoke: () => vm.runInContext(call, context),
  };
}

test('YouTube watchdog dispatch stays small and never retransmits the full runtime', () => {
  assert.ok(full.length > 20000, 'full runtime should be substantial');
  assert.ok(call.length < 400, 'watchdog payload must be tiny');
  assert.match(base, /kNativeMediaYoutubeWatchdogScript = kNativeMediaYoutubeCachedProbeScript/);
  assert.match(host, /AddScriptToExecuteOnDocumentCreated\(\s*kNativeMediaYoutubeControlRecoveryScript/);
  assert.match(host, /ExecutePolicyScript\(\s*requestView.Get\(\), kNativeMediaYoutubeWatchdogScript/);
  assert.match(host, /std::wstring_view\(json\) == L".*bootstrap.*"/);
  assert.match(host, /requestView.Get\(\), kNativeMediaYoutubeControlRecoveryScript/);
});

test('bootstrap establishes one reusable probe and avoids repeated timer allocations', () => {
  const page = environment();
  assert.equal(page.invoke(), 'bootstrap', 'SPA route with missing preload asks for bootstrap');
  assert.equal(page.inject(), 'recovery');
  const probe = page.window.__homePanelYoutubeProbe;
  assert.equal(typeof probe, 'function');
  assert.equal(page.calls.timers, 1);
  for (let i = 0; i < 100; i++) assert.equal(page.invoke(), 'recovery');
  assert.equal(page.calls.timers, 1, 'pending recovery wake must be reused');
  assert.equal(page.calls.queries, 101);
  assert.equal(page.calls.stateReads, 1,
    'cached probes retain the page runtime instead of reading window state 100 times');
  assert.equal(page.calls.stateWrites, 1);
  assert.equal(page.window.__homePanelYoutubeProbe, probe);
  assert.equal(page.inject(), 'recovery', 're-injection reuses the existing probe');
  assert.equal(page.window.__homePanelYoutubeProbe, probe);
});

test('non-watch page incurs no probe state, then SPA navigation can bootstrap', () => {
  const page = environment('/playlist');
  assert.equal(page.inject(), null);
  assert.equal(page.window.__homePanelYoutubeProbe, undefined);
  assert.equal(page.calls.timers, 0);
  page.location.pathname = '/watch';
  assert.equal(page.invoke(), 'bootstrap');
  assert.equal(page.inject(), 'recovery');
  assert.equal(page.invoke(), 'recovery');
  assert.equal(page.calls.timers, 1);
});

test('probe cache belongs to the page, not to another WebView document', () => {
  const original = environment();
  original.inject();
  assert.equal(original.invoke(), 'recovery');
  const next = environment();
  assert.equal(next.invoke(), 'bootstrap');
  next.inject();
  assert.notEqual(original.window.__homePanelYoutubeProbe, next.window.__homePanelYoutubeProbe);
  assert.equal(next.invoke(), 'recovery');
});


test('YouTube selectors and pure watchdog helpers are allocated once per document', () => {
  const outerStart = full.indexOf('  const state = window.__homePanelYoutubeRuntime');
  const probeStart = full.indexOf('  const probe = () => {');
  assert.ok(outerStart > 0 && probeStart > outerStart);
  for (const token of [
    'const postWake = () => {', 'const wake = (delay = 80) => {',
    'const recheck = () => wake(2000);',
    'const valid = element => Boolean(', 'const text = element => (',
    'const surveySelector =', 'const skipSelector =',
    'const adControlSelector =', 'const actionLane = action => {',
    'const actionState = action => {',
  ]) {
    const pos = full.indexOf(token);
    assert.ok(pos > outerStart && pos < probeStart,
      token + ' should not be recreated on each event/watchdog probe');
  }
  assert.ok(full.indexOf('const arm = (element, action, cooldownMs) => {') > probeStart,
    'player-dependent actions remain scoped to the current player');
});
