import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const header = readFileSync(
  new URL('../../native/src/sh_track_boundary_script.h', import.meta.url),
  'utf8',
);
const rawScript = header.match(/LR"JS\(([\s\S]*?)\)JS";/)?.[1];
assert.ok(rawScript, 'Stationhead track-boundary script must remain extractable');
const script = rawScript.replaceAll('{{PREFIX}}', 'stationhead');
const leaseKey = '__homepanelStationheadRecentPlayback:v2:stationhead';

function page({
  markerAgeMs = null,
  markerRoute = null,
  storage = new Map(),
  playFails = false,
  clock = { now: 1_000_000 },
} = {}) {
  const origin = 'https://www.stationhead.com';
  const pathname = '/channel/homepanel';
  const currentRoute = `${origin}${pathname}`;
  if (markerAgeMs !== null) {
    storage.set(
      leaseKey,
      `${clock.now - markerAgeMs}\n${markerRoute ?? currentRoute}`,
    );
  }

  const timers = [];
  const documentListeners = new Map();
  const windowListeners = new Map();
  let nextTimerId = 1;
  let window;

  class HTMLMediaElement {}
  HTMLMediaElement.HAVE_METADATA = 1;
  HTMLMediaElement.HAVE_CURRENT_DATA = 2;

  const media = new HTMLMediaElement();
  Object.assign(media, {
    paused: true,
    ended: false,
    readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
    isConnected: true,
    currentSrc: 'https://cdn.example/live.mp3',
    tagName: 'AUDIO',
    playCalls: 0,
    getAttribute: () => '',
    querySelector: () => null,
    async play() {
      this.playCalls += 1;
      if (playFails) throw new Error('simulated playback failure');
      this.paused = false;
      window.__homepanelAudioPlaying = true;
    },
  });

  const addListener = (listeners, name, handler) => {
    const handlers = listeners.get(name) ?? [];
    handlers.push(handler);
    listeners.set(name, handlers);
  };
  const document = {
    querySelectorAll: selector => selector === 'audio,video' ? [media] : [],
    addEventListener: (name, handler) => addListener(documentListeners, name, handler),
  };
  window = {
    location: {
      hostname: 'www.stationhead.com',
      origin,
      pathname,
    },
    __homepanelAudioPlaying: false,
    setTimeout(callback, delay) {
      const timer = { id: nextTimerId, callback, delay, cancelled: false };
      nextTimerId += 1;
      timers.push(timer);
      return timer.id;
    },
    clearTimeout(id) {
      const timer = timers.find(candidate => candidate.id === id);
      if (timer) timer.cancelled = true;
    },
    addEventListener: (name, handler) => addListener(windowListeners, name, handler),
    chrome: { webview: { postMessage() {} } },
  };
  const context = vm.createContext({
    window,
    document,
    location: window.location,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    HTMLMediaElement,
    Promise,
    Number,
    Array,
    Boolean,
    Math,
    String,
    Date: class extends Date {
      static now() { return clock.now; }
    },
  });
  vm.runInContext(script, context, {
    filename: 'stationhead-track-boundary-script.js',
  });

  const dispatch = (name, target = media) => {
    for (const handler of documentListeners.get(name) ?? []) handler({ target });
  };
  const activeTimers = () => timers.filter(timer => !timer.cancelled);
  const runNextTimer = async () => {
    const index = timers.findIndex(timer => !timer.cancelled);
    assert.notEqual(index, -1, 'expected a scheduled recovery timer');
    const [timer] = timers.splice(index, 1);
    timer.callback();
    await new Promise(resolve => setImmediate(resolve));
  };

  return {
    media,
    storage,
    dispatch,
    activeTimers,
    runNextTimer,
    advance: milliseconds => { clock.now += milliseconds; },
  };
}

test('track-boundary recovery does not autoplay a first-time or login page', () => {
  const state = page();
  assert.equal(state.activeTimers().length, 0);
  assert.equal(state.media.playCalls, 0);
});

test('track-boundary recovery resumes recent established playback after navigation', async () => {
  const state = page({ markerAgeMs: 60_000 });
  assert.equal(state.activeTimers().length, 1);

  await state.runNextTimer();

  assert.equal(state.media.playCalls, 1);
  assert.equal(state.media.paused, false);
});

test('track-boundary recovery ignores stale playback leases', () => {
  const state = page({ markerAgeMs: 31 * 60_000 });
  assert.equal(state.activeTimers().length, 0);
  assert.equal(state.media.playCalls, 0);
});

test('track-boundary recovery lease is restricted to the Stationhead route that played', () => {
  const state = page({
    markerAgeMs: 60_000,
    markerRoute: 'https://www.stationhead.com/channel/other',
  });
  assert.equal(state.activeTimers().length, 0);
  assert.equal(state.media.playCalls, 0);
});

test('confirmed playback lease survives WebView reconstruction', async () => {
  const storage = new Map();
  const firstDocument = page({ storage });
  firstDocument.dispatch('play');
  assert.equal(storage.has(leaseKey), false, 'play intent alone must not establish recovery');
  firstDocument.dispatch('playing');
  assert.equal(storage.has(leaseKey), true, 'confirmed playback must establish recovery');

  const replacementDocument = page({ storage });
  assert.equal(replacementDocument.activeTimers().length, 1);
  await replacementDocument.runNextTimer();
  assert.equal(replacementDocument.media.playCalls, 1);
});

test('failed recovery remains armed beyond the old fixed 30-second window', async () => {
  const state = page({ markerAgeMs: 60_000, playFails: true });
  state.advance(31_000);
  await state.runNextTimer();

  assert.equal(state.media.playCalls, 1);
  assert.equal(state.activeTimers().length, 1, 'failed playback must schedule another bounded retry');
});
