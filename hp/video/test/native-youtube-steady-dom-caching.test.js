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
    firstElementChild: children[0] || null,
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
  assert.match(runtime, /const pageState = \(\) => \{[\s\S]*queueMicrotask\(\(\) => \{[\s\S]*bindVideo\(true\)/);
});

test('rare YouTube dialogs do not subscribe to popup MutationObserver', () => {
  assert.doesNotMatch(runtime, /popupObserver|dialogMutations/);
  assert.match(runtime, /state\.dialogActive \? 30 \* 1000 : 5 \* 60 \* 1000/);
});

test('YouTube SPA event burst refreshes video selection once per microtask', () => {
  const source = section('    let pageStateQueued = false;',
    '  }\n  const video = bindVideo();');
  const listeners = new Map();
  const pending = [];
  let binds = 0;
  let wakes = 0;
  const player = {};
  const state = {
    player, pageAbort: { signal: {} },
    dialogCheckedAt: 1000, dialogActive: false,
  };
  vm.runInNewContext(
    '(() => { ' + source + '\nreturn null; })()',
    {
      state, player,
      bindVideo: refresh => {
        assert.equal(refresh, true);
        binds++;
      },
      wake: delay => {
        assert.equal(delay, 0);
        wakes++;
      },
      queueMicrotask: callback => { pending.push(callback); },
      document: {
        addEventListener(name, handler) {
          listeners.set(name, handler);
        },
      },
    },
  );
  assert.deepEqual([...listeners.keys()],
    ['yt-navigate-finish', 'yt-page-data-updated', 'fullscreenchange']);
  const notify = () => {
    listeners.get('yt-navigate-finish')();
    listeners.get('yt-page-data-updated')();
  };
  for (let i = 0; i < 100; i++) notify();
  assert.equal(pending.length, 1);
  assert.equal(binds, 0, 'defer redundant queries until after the event burst');
  pending.shift()();
  assert.equal(binds, 1);
  assert.equal(wakes, 1);
  assert.equal(state.dialogCheckedAt, 1000,
    'SPA data notifications must not restart the five-minute dialog timer');

  for (let i = 0; i < 50; i++) notify();
  assert.equal(pending.length, 1);
  pending.shift()();
  assert.equal(binds, 2, 'a later navigation burst must still be handled');
  assert.equal(wakes, 2);
  assert.equal(state.dialogCheckedAt, 1000,
    'later navigation bursts preserve the same dialog scan budget');

  notify();
  state.player = {};
  pending.shift()();
  assert.equal(binds, 2, 'stale player callbacks must not rebind the replaced player');
  assert.equal(wakes, 2);
  listeners.get('fullscreenchange')();
  assert.equal(wakes, 2, 'stale player fullscreen notifications are ignored');
  state.player = player;
  state.playerNeedsRefresh = false;
  listeners.get('fullscreenchange')();
  assert.equal(wakes, 3, 'fullscreen still triggers an immediate watchdog wake');
  assert.equal(binds, 2, 'fullscreen never re-queries/rebinds the media node');
  assert.equal(pending.length, 0);
  assert.equal(state.playerNeedsRefresh, false,
    'fullscreen does not invalidate the cached player');
});


test('returning from a long ad resets content stall grace before fullscreen recovery', () => {
  const code = section('  const adActive = ad();', '  if (adActive) {');
  const run = ({ wasAd, adNow, fullscreenNow, now = 120000 }) => {
    const state = {
      adActive: wasAd,
      lastProgressAt: 1000,
      lastCurrentTime: 75,
      nextRequestedAt: 5000,
    };
    const result = vm.runInNewContext(
      '(() => { ' + code + "\nreturn 'normal'; })()",
      {
        state, now,
        ad: () => adNow,
        syncAdObserver: () => {},
        fullscreen: () => fullscreenNow,
        video: { paused: false },
        requestFullscreen: () => 'request-fullscreen',
      },
    );
    return { state, result };
  };

  const adEnding = run({ wasAd: true, adNow: false, fullscreenNow: false });
  assert.equal(adEnding.result, 'request-fullscreen',
    'missing fullscreen still takes the existing recovery path');
  assert.equal(adEnding.state.lastProgressAt, 120000,
    'stall grace resets before fullscreen recovery can return early');
  assert.equal(adEnding.state.lastCurrentTime, -1);
  assert.equal(adEnding.state.nextRequestedAt, 0);

  const steady = run({ wasAd: false, adNow: false, fullscreenNow: true });
  assert.equal(steady.result, 'normal');
  assert.equal(steady.state.lastProgressAt, 1000,
    'healthy non-ad probes must not reset the stall detector');
  assert.equal(steady.state.lastCurrentTime, 75);

  const stillAd = run({ wasAd: true, adNow: true, fullscreenNow: true });
  assert.equal(stillAd.state.lastProgressAt, 1000,
    'ad playback itself is not misinterpreted as content progress');
});

test('rare YouTube dialogs scan every five minutes and retry visible prompts in 30 seconds', () => {
  const code = section('  const dismissMessageDialog = () => {', '  const bindVideo =');
  let now = 1000;
  let scans = 0;
  let lookups = 0;
  let roots = [];
  const first = { isConnected: true, querySelectorAll: () => { scans++; return []; } };
  const replacement = {
    isConnected: true,
    querySelectorAll: () => { scans++; return roots; },
  };
  let current = first;
  const state = { popup: first };
  const dismiss = vm.runInNewContext(
    '(() => { ' + code + '\nreturn dismissMessageDialog; })()',
    {
      state,
      Date: class extends Date { static now() { return now; } },
      document: { querySelector: () => { lookups++; return current; } },
      surveySelector: '.survey',
      text: node => node.label || '',
      valid: () => true,
      arm: () => null,
    },
  );
  for (let i = 0; i < 500; i++) assert.equal(dismiss(), null);
  assert.equal(scans, 1, '500 ad wakeups do not rescan an empty popup');
  assert.equal(lookups, 0);
  now += 5 * 60 * 1000 - 1;
  dismiss();
  assert.equal(scans, 1);
  now += 1;
  dismiss();
  assert.equal(scans, 2, 'idle dialogs are checked at five-minute boundaries');

  first.isConnected = false;
  current = replacement;
  now += 5 * 60 * 1000;
  dismiss();
  assert.equal(scans, 3, 'replaced popup is reacquired at the next scheduled check');
  assert.equal(lookups, 1);

  roots = [{
    label: 'Still watching',
    getClientRects: () => [1],
    matches: () => false,
    querySelector: () => null,
    querySelectorAll: () => [],
  }];
  now += 5 * 60 * 1000;
  dismiss();
  assert.equal(scans, 4);
  assert.equal(state.dialogActive, true, 'visible dialog activates 30-second retries');
  for (let i = 0; i < 100; i++) dismiss();
  assert.equal(scans, 4, 'active dialog is not polled on every ad wake');
  now += 30000;
  dismiss();
  assert.equal(scans, 5);
  assert.equal(state.dialogActive, true);

  roots = [];
  now += 30000;
  dismiss();
  assert.equal(scans, 6);
  assert.equal(state.dialogActive, false, 'dismissed dialog returns to five-minute cadence');
  now += 30000;
  dismiss();
  assert.equal(scans, 6);
});

test('missing popup also waits five minutes before its next DOM lookup', () => {
  const code = section('  const dismissMessageDialog = () => {', '  const bindVideo =');
  let now = 1000;
  let lookups = 0;
  const state = {};
  const dismiss = vm.runInNewContext(
    '(() => { ' + code + '\nreturn dismissMessageDialog; })()',
    {
      state,
      Date: class extends Date { static now() { return now; } },
      document: { querySelector: () => { lookups++; return null; } },
    },
  );
  for (let i = 0; i < 500; i++) dismiss();
  assert.equal(lookups, 1);
  now += 300000;
  dismiss();
  assert.equal(lookups, 2);
});
