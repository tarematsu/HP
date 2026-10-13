import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const raw = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url),
  'utf8',
);
const runtime = [...raw.matchAll(/LR"JS\(([\s\S]*?)\)JS"/g)]
  .map(([, part]) => part).join('');

function section(start, end) {
  const a = runtime.indexOf(start);
  const b = runtime.indexOf(end, a + start.length);
  assert.ok(a !== -1 && b > a, 'missing YouTube runtime section');
  return runtime.slice(a, b);
}

class MockObserver {
  constructor(callback) { this.callback = callback; }
  observe(target, options) { this.target = target; this.options = options; }
  disconnect() { this.disconnected = true; }
}

function makeNode(kind = 'other', children = [], parent = null) {
  const node = {
    nodeType: 1, kind, isConnected: true, parentElement: parent, children,
    matches: selector => kind === 'dialog' && selector.includes('[role="dialog"]'),
    closest: selector => {
      for (let p = node; p; p = p.parentElement) {
        if (p.matches?.(selector)) return p;
      }
      return null;
    },
    querySelector: selector =>
      children.find(child => child.matches(selector) || child.querySelector(selector)) || null,
  };
  for (const child of children) child.parentElement = node;
  return node;
}

test('stable YouTube playback reuses its video node until SPA refresh or detach', () => {
  const code = section('  const bindVideo = (refresh = false) => {', '  const syncAdObserver =');
  let selected;
  let queries = 0;
  let attached = 0;
  let wakes = 0;
  let aborted = 0;
  const newVideo = () => ({
    isConnected: true,
    addEventListener() { attached++; },
  });
  const first = newVideo();
  const second = newVideo();
  const third = newVideo();
  selected = first;
  const state = {};
  const player = {
    querySelector: selector => {
      assert.equal(selector, 'video');
      queries++;
      return selected;
    },
    contains: node => node !== third,
  };
  class CountingAbort {
    signal = {};
    abort() { aborted++; }
  }
  const bindVideo = vm.runInNewContext(
    `(() => { ${code}\nreturn bindVideo; })()`,
    { state, player, AbortController: CountingAbort, wake: () => { wakes++; } },
  );
  assert.equal(bindVideo(), first);
  for (let i = 0; i < 100; i++) assert.equal(bindVideo(), first);
  assert.deepEqual({ queries, attached, wakes, aborted },
    { queries: 1, attached: 6, wakes: 1, aborted: 0 });

  selected = second; // SPA can replace the video while old one is still connected
  assert.equal(bindVideo(true), second);
  assert.deepEqual({ queries, attached, wakes, aborted },
    { queries: 2, attached: 12, wakes: 2, aborted: 1 });

  selected = third;
  second.isConnected = false;
  // Detached nodes never stay in the cache.
  assert.equal(bindVideo(), third);
  assert.deepEqual({ queries, attached, wakes, aborted },
    { queries: 3, attached: 18, wakes: 3, aborted: 2 });

  selected = first;
  // Connected, but moved outside the player.
  assert.equal(bindVideo(), first);
  assert.deepEqual({ queries, attached, wakes, aborted },
    { queries: 4, attached: 24, wakes: 4, aborted: 3 });
  assert.match(runtime, /const pageState = \(\) => \{\s*bindVideo\(true\)/);
});

test('popup observer ignores decorative nodes and wakes only for dialog changes', () => {
  const code = section("    state.popup = document.querySelector('ytd-popup-container');",
    '  const video = bindVideo();').replace(/\n  }\s*$/, '');
  const popup = makeNode('popup');
  const dialog = makeNode('dialog');
  const icon = makeNode('icon');
  const insideDialog = makeNode('inside', [], dialog);
  const wrapper = makeNode('wrapper', [dialog]);
  let wakes = 0;
  const state = {};
  vm.runInNewContext(
    `(() => { ${code}\nreturn state.popupObserver; })()`,
    {
      state,
      document: { querySelector: () => popup },
      MutationObserver: MockObserver,
      wake: () => { wakes++; },
    },
  );
  const observer = state.popupObserver;
  assert.equal(observer.target, popup);
  assert.equal(observer.options.subtree, true);
  for (let i = 0; i < 100; i++) {
    observer.callback([{ type: 'childList', target: popup,
      addedNodes: [icon], removedNodes: [] }]);
  }
  assert.equal(wakes, 0, 'ordinary popup chrome must not wake the native watchdog');
  observer.callback([{ type: 'childList', target: popup,
    addedNodes: [wrapper], removedNodes: [] }]);
  assert.equal(wakes, 1, 'dialog added inside a wrapper must wake');
  observer.callback([{ type: 'childList', target: insideDialog,
    addedNodes: [icon], removedNodes: [] }]);
  assert.equal(wakes, 2, 'updates inside an active dialog must wake');
  observer.callback([{ type: 'childList', target: popup,
    addedNodes: [], removedNodes: [dialog] }]);
  assert.equal(wakes, 3, 'dialog removal must wake');
});

test('known popup stays cached for routine dialog checks', () => {
  const code = section('  const dismissMessageDialog = () => {', '  const bindVideo =');
  let queries = 0;
  const popup = { isConnected: true, querySelectorAll: () => [] };
  const dismiss = vm.runInNewContext(
    `(() => { ${code}\nreturn dismissMessageDialog; })()`,
    {
      state: { popup },
      document: { querySelector: () => { queries++; return popup; } },
    },
  );
  for (let i = 0; i < 100; i++) assert.equal(dismiss(), null);
  assert.equal(queries, 0);
  popup.isConnected = false;
  assert.equal(dismiss(), null);
  assert.equal(queries, 1, 'disconnected popup falls back to document lookup');
});
