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
  pauseCalls = 0;

  pause() {
    this.paused = true;
    this.pauseCalls += 1;
  }
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
    setTimeout(fn) {
      const id = nextTimer++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval() {
      return 0;
    },
    clearInterval() {},
  });
  vm.runInContext(observerScript, context);

  const dispatch = type => {
    for (const handler of listeners.get(type) || []) handler({ target: media });
  };
  const generation = value => {
    for (const handler of webviewListeners) handler({ data: `spotify:generation\x1f${value}` });
  };

  return { media, messages, dispatch, generation, timers };
}

test('music advances inside the final 1.5 seconds without waiting for ended', () => {
  const h = createHarness();
  h.generation(21);
  h.media.paused = false;
  h.media.currentTime = 100;
  h.dispatch('playing');
  assert.equal(h.messages.at(-1), 'spotify:timed-started\x1f21');

  h.media.currentTime = 178.4;
  h.dispatch('timeupdate');
  assert.equal(h.messages.filter(m => m === 'spotify:timed-ended\x1f21').length, 0);
  assert.equal(h.media.pauseCalls, 0);

  h.media.currentTime = 178.6;
  h.dispatch('timeupdate');
  assert.equal(h.messages.at(-1), 'spotify:timed-ended\x1f21');
  assert.equal(h.messages.filter(m => m === 'spotify:timed-ended\x1f21').length, 1);
  assert.equal(h.media.pauseCalls, 1);
  assert.equal(h.media.paused, true);
});

test('a near-end pause is completion rather than recovery', () => {
  const h = createHarness();
  h.generation(22);
  h.media.paused = false;
  h.media.currentTime = 120;
  h.dispatch('playing');

  h.media.currentTime = 179.2;
  h.media.paused = true;
  h.dispatch('pause');

  assert.equal(h.messages.at(-1), 'spotify:timed-ended\x1f22');
  assert.equal(h.messages.filter(m => m.startsWith('spotify:not-playing')).length, 0);
  assert.equal(h.timers.size, 0);
});
