import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const observerModules = [
  ['spotify_media_observer_runtime.inc', 'kSpotifyMediaObserverRuntimeScript'],
  ['spotify_media_observer_completion.inc', 'kSpotifyMediaObserverCompletionScript'],
  ['spotify_media_observer_events.inc', 'kSpotifyMediaObserverEventsScript'],
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
  duration = Number.NaN;
  playbackRate = 1;
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
    Date,
    Math,
    setTimeout(fn) {
      const id = nextTimer++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
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

  return {
    window,
    navigator,
    media,
    messages,
    dispatch,
    hostMessage,
    setTrack,
    runTimers,
  };
}

test('target identity and wrong-track rejection have one runtime owner', () => {
  const runtime = observerModules.find(({ file }) =>
    file === 'spotify_media_observer_runtime.inc').source;
  const events = observerModules.find(({ file }) =>
    file === 'spotify_media_observer_events.inc').source;

  assert.match(runtime, /const enforceTarget = media =>/);
  assert.match(runtime, /const scheduleTargetChecks = media =>/);
  assert.doesNotMatch(runtime + events,
    /rejectWrongTrack|scheduleIdentityCheck|confirmStarted|scheduleStartChecks/);
  assert.match(events, /scheduleTargetChecks\(event\.target\)/);
  assert.match(events, /enforceTarget\(event\.target\)/);
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

test('natural end posts completion without pausing, then old-generation autoplay is quarantined', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f7');
  h.setTrack('/track/A', 'Target A');
  h.media.paused = false;
  h.dispatch('playing');
  assert.equal(h.messages.at(-1), 'spotify:timed-started\x1f7');

  h.media.ended = true;
  h.dispatch('ended');
  assert.equal(h.messages.at(-1), 'spotify:timed-ended\x1f7');
  assert.equal(h.media.pauseCalls, 0);

  h.media.ended = false;
  h.media.paused = false;
  h.dispatch('play');
  assert.equal(h.media.pauseCalls, 1);
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

test('wrong-track detection is passive and never requests native recovery', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f11');
  h.setTrack('/track/A', 'Target A');
  h.media.paused = false;
  h.dispatch('playing');
  assert.equal(h.messages.at(-1), 'spotify:timed-started\x1f11');

  h.setTrack('/track/RECOMMENDED', 'Recommended Song');
  h.dispatch('loadedmetadata');
  h.runTimers();

  assert.equal(h.media.pauseCalls, 0);
  assert.equal(h.media.paused, false);
  assert.equal(h.messages.some(m => m.startsWith('spotify:not-playing')), false);
  const runtime = h.window.__homePanelSpotifyMediaObserverRuntime;
  assert.equal(runtime.state.started, false);
  assert.equal(runtime.requestRecovery, undefined);
  assert.equal(runtime.scheduleRecovery, undefined);
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
  assert.equal(h.window.__homePanelSpotifyMediaObserverRuntime.state.started, true);
});

test('observer has no heartbeat or recovery API', () => {
  const h = createHarness();
  const runtime = h.window.__homePanelSpotifyMediaObserverRuntime;
  assert.equal(runtime.requestRecovery, undefined);
  assert.equal(runtime.scheduleRecovery, undefined);
  assert.equal(runtime.startHeartbeat, undefined);
  assert.equal(runtime.stopHeartbeat, undefined);
  assert.equal('heartbeatTimer' in runtime, false);
  assert.equal('recoveryPosted' in runtime.state, false);
  assert.equal('restartPending' in runtime.state, false);
});

test('production observer never advances merely by reaching duration', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f14');
  h.setTrack('/track/A', 'Target A');
  h.media.paused = false;
  h.media.currentTime = 100;
  h.media.duration = 180;
  h.dispatch('playing');

  h.media.currentTime = 178.6;
  h.dispatch('timeupdate');
  assert.equal(h.messages.filter(m => m === 'spotify:timed-ended\x1f14').length, 0);
  assert.equal(h.media.pauseCalls, 0);

  h.media.currentTime = 180;
  h.dispatch('timeupdate');
  assert.equal(h.messages.filter(m => m === 'spotify:timed-ended\x1f14').length, 0);

  h.media.ended = true;
  h.dispatch('ended');
  assert.equal(h.messages.at(-1), 'spotify:timed-ended\x1f14');
  assert.equal(h.messages.filter(m => m === 'spotify:timed-ended\x1f14').length, 1);
  assert.equal(h.media.pauseCalls, 0);
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
  assert.equal(pausedAfterEnd, 0);

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

test('trusted native Play establishes start and deadline when Spotify identity is temporarily absent', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f21');
  const runtime = h.window.__homePanelSpotifyMediaObserverRuntime;
  assert.equal(runtime.armTrustedStart('21'), true);

  h.setTrack(null, '');
  h.navigator.mediaSession.metadata.title = '';
  h.media.currentTime = 1;
  h.media.duration = 181;
  h.media.paused = false;
  h.dispatch('playing');

  assert.equal(
    h.messages.filter(m => m === 'spotify:timed-started\x1f21').length,
    1,
  );
  assert.ok(h.messages.some(m => m.startsWith('spotify:timed-plan\x1f21\x1f')));
  assert.equal(runtime.state.started, true);
  assert.equal(runtime.state.targetMedia, h.media);
});

test('trusted native Play never overrides a concrete wrong-track identity', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f22');
  const runtime = h.window.__homePanelSpotifyMediaObserverRuntime;
  assert.equal(runtime.armTrustedStart('22'), true);

  h.setTrack('/track/B', 'Wrong B');
  h.media.currentTime = 1;
  h.media.duration = 180;
  h.media.paused = false;
  h.dispatch('playing');
  assert.equal(h.messages.some(m => m.startsWith('spotify:timed-started')), false);

  h.setTrack(null, '');
  h.dispatch('playing');
  assert.equal(h.messages.some(m => m.startsWith('spotify:timed-started')), false);
  assert.equal(runtime.state.started, false);
});
