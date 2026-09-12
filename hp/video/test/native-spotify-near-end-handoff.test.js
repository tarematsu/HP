import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function rawScript(file, symbol) {
  const source = readFileSync(new URL(`../../native/src/${file}`, import.meta.url), 'utf8');
  const prefix = `constexpr wchar_t ${symbol}[] = LR"JS(\n`;
  const start = source.indexOf(prefix);
  assert.notEqual(start, -1, `${symbol} raw string not found`);
  const bodyStart = start + prefix.length;
  const end = source.indexOf('\n)JS";', bodyStart);
  assert.notEqual(end, -1, `${symbol} raw string terminator not found`);
  return source.slice(bodyStart, end);
}

const observerScript = [
  rawScript('spotify_media_observer_runtime.inc', 'kSpotifyMediaObserverRuntimeScript'),
  rawScript('spotify_media_observer_events.inc', 'kSpotifyMediaObserverEventsScript'),
].join(';\n');

class FakeMedia {
  paused = true;
  ended = false;
  currentTime = 0;
  duration = 180;
  playbackRate = 1;
}

function createHarness() {
  const listeners = new Map();
  const webviewListeners = [];
  const messages = [];
  const timers = new Map();
  let nextTimer = 1;
  const media = new FakeMedia();
  const track = {
    href: 'https://open.spotify.com/track/A',
    textContent: 'Target A',
  };

  const window = {
    __homePanelSpotifyNativeTarget: {
      pagePath: '/track/A',
      trackPath: '/track/A',
      title: 'Target A',
      kind: 'music',
    },
    chrome: {
      webview: {
        postMessage(message) {
          messages.push(message);
        },
        addEventListener(type, handler) {
          if (type === 'message') webviewListeners.push(handler);
        },
      },
    },
  };
  const document = {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    querySelector() {
      return track;
    },
    querySelectorAll(selector) {
      return selector === 'audio, video' ? [media] : [];
    },
  };
  const context = vm.createContext({
    window,
    document,
    navigator: { mediaSession: { metadata: { title: 'Target A' } } },
    HTMLMediaElement: FakeMedia,
    location: { href: 'https://open.spotify.com/track/A' },
    URL,
    Number,
    Array,
    String,
    Math,
    Date,
    setTimeout(fn) {
      const id = nextTimer++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  });
  vm.runInContext(observerScript, context);

  const dispatch = type => {
    for (const handler of listeners.get(type) || []) handler({ target: media });
  };
  const hostMessage = data => {
    for (const handler of webviewListeners) handler({ data });
  };

  return { media, messages, dispatch, hostMessage, listeners, timers };
}

test('music start publishes exactly one remaining-duration event', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f21');
  h.media.paused = false;
  h.media.currentTime = 100;
  h.dispatch('playing');

  assert.deepEqual(h.messages, ['spotify:timed-started\x1f21\x1f80000']);

  h.dispatch('playing');
  h.dispatch('durationchange');
  assert.deepEqual(h.messages, ['spotify:timed-started\x1f21\x1f80000']);
});

test('remaining duration accounts for playback rate once at start', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f22');
  h.media.paused = false;
  h.media.currentTime = 60;
  h.media.duration = 180;
  h.media.playbackRate = 2;
  h.dispatch('playing');

  assert.deepEqual(h.messages, ['spotify:timed-started\x1f22\x1f60000']);
});

test('invalid duration waits for metadata instead of arming a bad timer', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f23');
  h.media.paused = false;
  h.media.duration = Number.NaN;
  h.dispatch('playing');
  assert.deepEqual(h.messages, []);

  h.media.duration = 180;
  h.media.currentTime = 1;
  h.dispatch('durationchange');
  assert.deepEqual(h.messages, ['spotify:timed-started\x1f23\x1f179000']);
});

test('completion lifecycle events are not installed', () => {
  const h = createHarness();
  for (const type of ['timeupdate', 'seeking', 'seeked', 'waiting', 'stalled', 'pause', 'ended']) {
    assert.equal(h.listeners.has(type), false, `${type} must not be observed`);
  }
  for (const type of ['play', 'playing', 'loadedmetadata', 'durationchange']) {
    assert.equal(h.listeners.has(type), true, `${type} must be observed`);
  }
});

test('rewind to zero cannot produce a second start event for the generation', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f24');
  h.media.paused = false;
  h.media.currentTime = 0;
  h.dispatch('playing');
  assert.deepEqual(h.messages, ['spotify:timed-started\x1f24\x1f180000']);

  h.media.currentTime = 0.1;
  h.dispatch('playing');
  assert.deepEqual(h.messages, ['spotify:timed-started\x1f24\x1f180000']);
});
