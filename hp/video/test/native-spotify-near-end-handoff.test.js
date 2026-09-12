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
  rawScript('spotify_media_observer_completion.inc', 'kSpotifyMediaObserverCompletionScript'),
  rawScript('spotify_media_observer_events.inc', 'kSpotifyMediaObserverEventsScript'),
].join(';\n');

class FakeMedia {
  paused = true;
  ended = false;
  currentTime = 0;
  duration = 180;
  playbackRate = 1;
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
  let wallNow = 1_000_000;
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
    Date: { now: () => wallNow },
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
  const advanceWall = milliseconds => {
    wallNow += milliseconds;
  };

  return { media, messages, dispatch, hostMessage, advanceWall, timers };
}

test('music start publishes one remaining-time plan for native scheduling', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f21');
  h.media.paused = false;
  h.media.currentTime = 100;
  h.dispatch('playing');

  assert.equal(h.messages[0], 'spotify:timed-started\x1f21');
  assert.equal(h.messages[1], 'spotify:timed-plan\x1f21\x1f80000');
  assert.equal(h.messages.filter(m => m.startsWith('spotify:timed-plan\x1f21')).length, 1);
});

test('native completion probe near end re-arms instead of truncating playback', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f22');
  h.media.paused = false;
  h.media.currentTime = 120;
  h.dispatch('playing');

  h.media.currentTime = 178.8;
  h.hostMessage('spotify:completion-probe\x1f22');

  assert.equal(h.messages.filter(m => m === 'spotify:timed-ended\x1f22').length, 0);
  assert.equal(h.messages.at(-1), 'spotify:timed-plan\x1f22\x1f1200');
  assert.equal(h.media.pauseCalls, 0);
  assert.equal(h.media.paused, false);

  h.media.ended = true;
  h.dispatch('ended');
  assert.equal(h.messages.at(-1), 'spotify:timed-ended\x1f22');
  assert.equal(h.messages.filter(m => m === 'spotify:timed-ended\x1f22').length, 1);
  assert.equal(h.media.pauseCalls, 0);
});

test('an early native probe re-arms from the actual media clock instead of advancing', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f23');
  h.media.paused = false;
  h.media.currentTime = 100;
  h.dispatch('playing');

  h.media.currentTime = 170;
  h.hostMessage('spotify:completion-probe\x1f23');

  assert.equal(h.messages.filter(m => m === 'spotify:timed-ended\x1f23').length, 0);
  assert.equal(h.messages.at(-1), 'spotify:timed-plan\x1f23\x1f10000');
  assert.equal(h.media.pauseCalls, 0);
});

test('an early probe always returns a plan even when the media clock is unchanged', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f24');
  h.media.paused = false;
  h.media.currentTime = 100;
  h.dispatch('playing');

  h.hostMessage('spotify:completion-probe\x1f24');

  assert.equal(h.messages.filter(m => m === 'spotify:timed-plan\x1f24\x1f80000').length, 2);
  assert.equal(h.messages.filter(m => m === 'spotify:timed-ended\x1f24').length, 0);
});

test('a delayed completion probe treats a post-end rewind as completion', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f25');
  h.media.paused = false;
  h.media.currentTime = 0;
  h.dispatch('playing');

  h.advanceWall(180_100);
  h.media.currentTime = 0.1;
  h.hostMessage('spotify:completion-probe\x1f25');

  assert.equal(h.messages.at(-1), 'spotify:timed-ended\x1f25');
  assert.equal(h.messages.filter(m => m === 'spotify:timed-ended\x1f25').length, 1);
  assert.equal(h.messages.filter(m => m.startsWith('spotify:timed-plan\x1f25')).length, 1);
  assert.equal(h.media.pauseCalls, 1);
  assert.equal(h.media.paused, true);
});

test('a witnessed terminal rewind completes even before the projected deadline expires', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f26');
  h.media.paused = false;
  h.media.currentTime = 0;
  h.dispatch('playing');

  h.advanceWall(178_500);
  h.media.currentTime = 178.8;
  h.hostMessage('spotify:completion-probe\x1f26');
  assert.equal(h.messages.at(-1), 'spotify:timed-plan\x1f26\x1f1200');

  h.advanceWall(300);
  h.media.currentTime = 0.2;
  h.dispatch('seeking');

  assert.equal(h.messages.at(-1), 'spotify:timed-ended\x1f26');
  assert.equal(h.messages.filter(m => m === 'spotify:timed-ended\x1f26').length, 1);
  assert.equal(h.media.pauseCalls, 1);
  assert.equal(h.media.paused, true);
});

test('a rewind without a terminal high-water witness is not completion', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f30');
  h.media.paused = false;
  h.media.currentTime = 0;
  h.dispatch('playing');

  h.advanceWall(60_000);
  h.media.currentTime = 60;
  h.dispatch('timeupdate');
  h.media.currentTime = 0.2;
  h.dispatch('seeking');

  assert.equal(h.messages.filter(m => m === 'spotify:timed-ended\x1f30').length, 0);
  assert.equal(h.media.pauseCalls, 0);
  assert.equal(h.messages.at(-1), 'spotify:timed-plan-clear\x1f30');
});

test('an expired completion probe wins even if Spotify has already paused', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f27');
  h.media.paused = false;
  h.media.currentTime = 0;
  h.dispatch('playing');

  h.advanceWall(180_100);
  h.media.currentTime = 0.1;
  h.media.paused = true;
  h.hostMessage('spotify:completion-probe\x1f27');

  assert.equal(h.messages.at(-1), 'spotify:timed-ended\x1f27');
  assert.equal(h.messages.filter(m => m === 'spotify:timed-ended\x1f27').length, 1);
});

test('waiting and pause stay passive when no terminal witness exists', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f29');
  h.media.paused = false;
  h.media.currentTime = 0;
  h.dispatch('playing');

  h.advanceWall(177_000);
  h.media.currentTime = 177;
  h.dispatch('waiting');
  assert.equal(h.messages.at(-1), 'spotify:timed-plan-clear\x1f29');

  h.media.currentTime = 0.2;
  h.media.paused = true;
  h.dispatch('pause');

  assert.equal(h.messages.filter(m => m === 'spotify:timed-ended\x1f29').length, 0);
  assert.equal(h.messages.filter(m => m.startsWith('spotify:not-playing')).length, 0);
  assert.equal(h.media.pauseCalls, 0);
  assert.equal(h.timers.size, 0);
});

test('pause away from the end clears the native deadline without scheduling recovery', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f28');
  h.media.paused = false;
  h.media.currentTime = 60;
  h.dispatch('playing');

  h.media.currentTime = 90;
  h.media.paused = true;
  h.dispatch('pause');

  assert.equal(h.messages.at(-1), 'spotify:timed-plan-clear\x1f28');
  assert.equal(h.messages.filter(m => m === 'spotify:timed-ended\x1f28').length, 0);
  assert.equal(h.messages.filter(m => m.startsWith('spotify:not-playing')).length, 0);
  assert.equal(h.timers.size, 0);
});
