import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function rawScript(file, symbol) {
  const source = readFileSync(new URL(`../../native/src/${file}`, import.meta.url), 'utf8');
  const assignment = `constexpr wchar_t ${symbol}[] =`;
  let cursor = source.indexOf(assignment);
  assert.notEqual(cursor, -1, `${symbol} assignment not found`);
  cursor += assignment.length;
  const opener = 'LR"JS(\n';
  const closer = '\n)JS"';
  const chunks = [];
  while (true) {
    while (/\s/.test(source[cursor] || '')) cursor += 1;
    if (!source.startsWith(opener, cursor)) break;
    const bodyStart = cursor + opener.length;
    const end = source.indexOf(closer, bodyStart);
    assert.notEqual(end, -1, `${symbol} raw string terminator not found`);
    chunks.push(source.slice(bodyStart, end));
    cursor = end + closer.length;
  }
  assert.ok(chunks.length > 0, `${symbol} raw string not found`);
  return chunks.join('\n');
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
  const track = { href: 'https://open.spotify.com/track/A', textContent: 'Target A' };
  const window = {
    __homePanelSpotifyNativeTarget: { pagePath: '/track/A', trackPath: '/track/A', title: 'Target A', kind: 'music' },
    chrome: { webview: {
      postMessage(message) { messages.push(message); },
      addEventListener(type, handler) { if (type === 'message') webviewListeners.push(handler); },
    } },
  };
  const document = {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    querySelector() { return track; },
    querySelectorAll(selector) { return selector === 'audio, video' ? [media] : []; },
  };
  const context = vm.createContext({
    window, document,
    navigator: { mediaSession: { metadata: { title: 'Target A' } } },
    HTMLMediaElement: FakeMedia,
    location: { href: 'https://open.spotify.com/track/A' },
    URL, Number, Array, String, Math, Date,
    setTimeout(fn) { const id = nextTimer++; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
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

test('invalid duration waits for durationchange instead of arming a bad timer', () => {
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

test('observer uses lifecycle events instead of renderer timers for startup identity', () => {
  const h = createHarness();
  for (const type of ['seeking', 'seeked', 'waiting', 'stalled', 'pause', 'play']) {
    assert.equal(h.listeners.has(type), false, `${type} must not be observed`);
  }
  for (const type of ['playing', 'durationchange', 'loadedmetadata', 'canplay', 'timeupdate', 'ended']) {
    assert.equal(h.listeners.has(type), true, `${type} must be observed`);
  }
});

test('validated requested-track ended publishes one generation-tagged shortening signal', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f24');
  h.media.paused = false;
  h.dispatch('playing');
  h.media.ended = true;
  h.dispatch('ended');
  assert.deepEqual(h.messages, [
    'spotify:timed-started\x1f24\x1f180000',
    'spotify:timed-ended\x1f24',
  ]);
});

test('rewind to zero cannot produce a second start event for the generation', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f25');
  h.media.paused = false;
  h.dispatch('playing');
  assert.deepEqual(h.messages, ['spotify:timed-started\x1f25\x1f180000']);
  h.media.currentTime = 0.1;
  h.dispatch('playing');
  assert.deepEqual(h.messages, ['spotify:timed-started\x1f25\x1f180000']);
});
