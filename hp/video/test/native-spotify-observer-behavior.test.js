import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const observerModules = [
  ['spotify_media_observer_runtime.inc', 'kSpotifyMediaObserverRuntimeScript'],
  ['spotify_media_observer_events.inc', 'kSpotifyMediaObserverEventsScript'],
  ['spotify_media_observer_heartbeat.inc', 'kSpotifyMediaObserverHeartbeatScript'],
].map(([file, symbol]) => ({
  file,
  symbol,
  source: readFileSync(new URL(`../../native/src/${file}`, import.meta.url), 'utf8'),
}));

function rawScript(source, symbol) {
  const prefix = `constexpr wchar_t ${symbol}[] = LR"JS(\n`;
  const start = source.indexOf(prefix);
  assert.notEqual(start, -1, `${symbol} raw string not found`);
  const bodyStart = start + prefix.length;
  const end = source.indexOf('\n)JS";', bodyStart);
  assert.notEqual(end, -1, `${symbol} raw string terminator not found`);
  return source.slice(bodyStart, end);
}

function productionObserverScript() {
  return observerModules
    .map(({ source, symbol }) => rawScript(source, symbol))
    .join(';\n') + ';';
}

class FakeMedia {
  paused = true;
  ended = false;
  currentTime = 0;
  pauseCalls = 0;

  pause() {
    this.paused = true;
    this.pauseCalls += 1;
  }
}

function createHarness() {
  const documentListeners = new Map();
  const webviewListeners = [];
  const messages = [];
  const timers = new Map();
  const intervals = new Map();
  let nextTimer = 1;
  let currentTrack = null;

  const media = new FakeMedia();
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
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(handler);
    },
    querySelector() {
      return currentTrack;
    },
    querySelectorAll(selector) {
      return selector === 'audio, video' ? [media] : [];
    },
  };
  const navigator = { mediaSession: { metadata: { title: '' } } };

  const context = vm.createContext({
    window,
    document,
    navigator,
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
    setInterval(fn, delay) {
      const id = nextTimer++;
      intervals.set(id, { fn, delay });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
  });
  vm.runInContext(productionObserverScript(), context);

  const dispatch = (type, target = media) => {
    for (const handler of documentListeners.get(type) || []) {
      handler({ target });
    }
  };
  const hostMessage = data => {
    for (const handler of webviewListeners) handler({ data });
  };
  const setTrack = (path, title) => {
    currentTrack = path ? {
      href: `https://open.spotify.com${path}`,
      textContent: title,
    } : null;
  };
  const runTimers = () => {
    const pending = [...timers.values()];
    timers.clear();
    for (const fn of pending) fn();
  };
  const runHeartbeat = () => {
    const heartbeat = [...intervals.values()].find(({ delay }) => delay === 10000);
    assert.ok(heartbeat, '10-second media heartbeat not installed');
    heartbeat.fn();
  };

  return {
    window,
    navigator,
    media,
    messages,
    dispatch,
    hostMessage,
    setTrack,
    runTimers,
    runHeartbeat,
  };
}

test('target identity and wrong-track rejection have one runtime owner', () => {
  const runtime = observerModules.find(({ file }) =>
    file === 'spotify_media_observer_runtime.inc').source;
  const events = observerModules.find(({ file }) =>
    file === 'spotify_media_observer_events.inc').source;
  const heartbeat = observerModules.find(({ file }) =>
    file === 'spotify_media_observer_heartbeat.inc').source;

  assert.match(runtime, /const enforceTarget = media =>/);
  assert.match(runtime, /const scheduleTargetChecks = media =>/);
  assert.doesNotMatch(runtime + events + heartbeat,
    /rejectWrongTrack|scheduleIdentityCheck|confirmStarted|scheduleStartChecks/);
  assert.match(events, /scheduleTargetChecks\(event\.target\)/);
  assert.match(events, /enforceTarget\(event\.target\)/);
  assert.match(heartbeat, /enforceTarget\(media\)/);
});

test('production observer prefers direct Track ID over title fallback', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f7');

  h.setTrack('/track/B', 'Different Track');
  h.navigator.mediaSession.metadata.title = 'Target A';
  h.media.paused = false;
  h.dispatch('playing');
  assert.deepEqual(h.messages, []);
  assert.equal(h.media.pauseCalls, 0);

  h.setTrack('/track/A', 'Target A');
  h.dispatch('playing');
  assert.deepEqual(h.messages, ['spotify:timed-started\x1f7']);
});

test('production observer ends immediately, blocks the old queue, then starts the new generation', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f7');
  h.setTrack('/track/A', 'Target A');
  h.media.paused = false;
  h.dispatch('playing');
  assert.equal(h.messages.at(-1), 'spotify:timed-started\x1f7');

  h.media.ended = true;
  h.dispatch('ended');
  assert.equal(h.messages.at(-1), 'spotify:timed-ended\x1f7');
  const pausedAfterEnd = h.media.pauseCalls;

  h.media.ended = false;
  h.media.paused = false;
  h.dispatch('play');
  assert.equal(h.media.pauseCalls, pausedAfterEnd + 1);
  assert.equal(h.messages.filter(m => m.startsWith('spotify:timed-started')).length, 1);

  h.window.__homePanelSpotifyNativeTarget = {
    pagePath: '/track/C',
    trackPath: '/track/C',
    title: 'Target C',
    kind: 'music',
  };
  h.hostMessage('spotify:target\x1f/track/C\x1f/track/C\x1fTarget C\x1fmusic');
  h.hostMessage('spotify:generation\x1f8');
  h.setTrack('/track/C', 'Target C');
  h.media.paused = false;
  h.dispatch('playing');
  assert.equal(h.messages.at(-1), 'spotify:timed-started\x1f8');
});

test('shared target checks stop a recommendation and request native recovery once', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f11');
  h.setTrack('/track/A', 'Target A');
  h.media.paused = false;
  h.dispatch('playing');
  assert.equal(h.messages.at(-1), 'spotify:timed-started\x1f11');

  h.setTrack('/track/RECOMMENDED', 'Recommended Song');
  h.media.paused = false;
  h.dispatch('loadedmetadata');
  assert.equal(h.media.pauseCalls, 0);
  h.runTimers();

  assert.equal(h.media.pauseCalls, 1);
  assert.equal(h.media.paused, true);
  assert.equal(h.messages.at(-1), 'spotify:not-playing\x1f11');
  assert.equal(h.messages.filter(m => m === 'spotify:not-playing\x1f11').length, 1);
});

test('shared target checks tolerate stale UI until the requested identity appears', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f12');
  h.setTrack('/track/A', 'Target A');
  h.media.paused = false;
  h.dispatch('playing');

  h.setTrack('/track/STALE', 'Stale UI');
  h.dispatch('loadedmetadata');
  h.setTrack('/track/A', 'Target A');
  h.runTimers();

  assert.equal(h.media.pauseCalls, 0);
  assert.equal(h.messages.filter(m => m.startsWith('spotify:not-playing')).length, 0);
});

test('heartbeat fallback stops a recommendation if source-change events are missed', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f13');
  h.setTrack('/track/A', 'Target A');
  h.media.paused = false;
  h.media.currentTime = 8;
  h.dispatch('playing');

  h.setTrack('/track/RECOMMENDED', 'Recommended Song');
  h.media.paused = false;
  h.runHeartbeat();

  assert.equal(h.media.pauseCalls, 1);
  assert.equal(h.messages.at(-1), 'spotify:not-playing\x1f13');
});

test('production observer detects a silent media-clock freeze after two heartbeat misses', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f9');
  h.setTrack('/track/A', 'Target A');
  h.media.paused = false;
  h.media.currentTime = 12;
  h.dispatch('playing');
  assert.equal(h.messages.at(-1), 'spotify:timed-started\x1f9');

  h.runHeartbeat();
  assert.equal(h.messages.filter(m => m.startsWith('spotify:not-playing')).length, 0);
  h.runHeartbeat();
  assert.equal(h.messages.at(-1), 'spotify:not-playing\x1f9');
});

test('production heartbeat stays healthy while media currentTime advances', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f10');
  h.setTrack('/track/A', 'Target A');
  h.media.paused = false;
  h.media.currentTime = 20;
  h.dispatch('playing');

  h.media.currentTime = 25;
  h.runHeartbeat();
  h.media.currentTime = 30;
  h.runHeartbeat();
  h.media.currentTime = 35;
  h.runHeartbeat();
  assert.equal(h.messages.filter(m => m.startsWith('spotify:not-playing')).length, 0);
});

test('production observer waits for natural track end before advancing', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f14');
  h.setTrack('/track/A', 'Target A');
  h.media.paused = false;
  h.media.currentTime = 100;
  h.media.duration = 180;
  h.dispatch('playing');

  h.media.currentTime = 179.4;
  h.dispatch('timeupdate');

  assert.equal(h.media.paused, false);
  assert.equal(h.messages.filter(m => m === 'spotify:timed-ended\x1f14').length, 0);

  h.media.ended = true;
  h.dispatch('ended');

  assert.equal(h.media.paused, true);
  assert.equal(h.messages.at(-1), 'spotify:timed-ended\x1f14');
  assert.equal(h.messages.filter(m => m === 'spotify:timed-ended\x1f14').length, 1);
});

test('completed generation quarantines same-media recommendation without a new play event', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f15');
  h.setTrack('/track/A', 'Target A');
  h.media.paused = false;
  h.dispatch('playing');

  h.media.ended = true;
  h.dispatch('ended');
  const pausedAfterEnd = h.media.pauseCalls;

  h.media.ended = false;
  h.media.paused = false;
  h.media.currentTime = 0.2;
  h.media.duration = 200;
  h.setTrack('/track/RECOMMENDED', 'Recommended Song');
  h.dispatch('timeupdate');

  assert.equal(h.media.paused, true);
  assert.equal(h.media.pauseCalls, pausedAfterEnd + 1);
  assert.equal(h.messages.filter(m => m.startsWith('spotify:not-playing')).length, 0);
  assert.equal(h.messages.filter(m => m === 'spotify:timed-ended\x1f15').length, 1);
});
