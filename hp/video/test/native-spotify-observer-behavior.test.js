import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const observerModules = [
  ['spotify_media_observer_runtime.inc', 'kSpotifyMediaObserverRuntimeScript'],
  ['spotify_media_observer_events.inc', 'kSpotifyMediaObserverEventsScript'],
].map(([file, symbol]) => ({
  file,
  symbol,
  source: readFileSync(new URL(`../../native/src/${file}`, import.meta.url), 'utf8'),
}));

function rawScript(source, symbol) {
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
}

function createHarness() {
  const documentListeners = new Map();
  const webviewListeners = [];
  const messages = [];
  const timers = new Map();
  let nextTimer = 1;
  let currentTrack = null;
  let nowMs = 1_000;

  const media = new FakeMedia();
  const window = {
    __homePanelSpotifyNativeTarget: {
      path: '/track/A',
      title: 'Target A',
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
    Date: { now: () => nowMs },
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
  const advanceTime = ms => {
    nowMs += ms;
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
    advanceTime,
    documentListeners,
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
});

test('production observer prefers direct Track ID and reports remaining duration once', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f7');

  h.setTrack('/track/B', 'Different Track');
  h.navigator.mediaSession.metadata.title = 'Target A';
  h.media.duration = 180;
  h.media.paused = false;
  h.dispatch('playing');
  assert.deepEqual(h.messages, []);

  h.setTrack('/track/A', 'Target A');
  h.media.currentTime = 20;
  h.dispatch('playing');
  assert.deepEqual(h.messages, ['spotify:timed-started\x1f7\x1f160000']);

  h.dispatch('playing');
  assert.deepEqual(h.messages, ['spotify:timed-started\x1f7\x1f160000']);
});

test('invalid duration waits until metadata becomes usable', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f12');
  h.setTrack('/track/A', 'Target A');
  h.media.paused = false;
  h.dispatch('playing');
  assert.deepEqual(h.messages, []);

  h.media.duration = 181;
  h.media.currentTime = 1;
  h.dispatch('loadedmetadata');
  assert.deepEqual(h.messages, ['spotify:timed-started\x1f12\x1f180000']);
});

test('trusted native Play establishes start when Spotify identity is temporarily absent', () => {
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

  assert.deepEqual(h.messages, ['spotify:timed-started\x1f21\x1f180000']);
  assert.equal(runtime.state.startPosted, true);
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
  assert.equal(runtime.state.startPosted, false);
});

test('non-track advertisement time is measured until the requested track resumes', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f31');
  h.setTrack('/track/A', 'Target A');
  h.media.duration = 180;
  h.media.currentTime = 10;
  h.media.paused = false;
  h.dispatch('playing');

  h.advanceTime(500);
  h.setTrack(null, '');
  h.navigator.mediaSession.metadata.title = 'Advertisement';
  h.dispatch('playing');

  h.advanceTime(30_000);
  h.setTrack('/track/A', 'Target A');
  h.navigator.mediaSession.metadata.title = 'Target A';
  h.media.currentTime = 11;
  h.dispatch('playing');

  assert.deepEqual(h.messages, [
    'spotify:timed-started\x1f31\x1f170000',
    'spotify:timed-interruption-started\x1f31',
    'spotify:timed-interruption-ended\x1f31\x1f30000',
  ]);
});

test('advertisement before the target starts extends timing without starting the target timer', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f32');
  h.setTrack(null, '');
  h.navigator.mediaSession.metadata.title = 'Advertisement';
  h.media.paused = false;
  h.dispatch('playing');
  assert.deepEqual(h.messages, ['spotify:timed-interruption-started\x1f32']);

  h.advanceTime(20_000);
  h.setTrack('/track/A', 'Target A');
  h.navigator.mediaSession.metadata.title = 'Target A';
  h.media.duration = 181;
  h.media.currentTime = 1;
  h.dispatch('playing');

  assert.deepEqual(h.messages, [
    'spotify:timed-interruption-started\x1f32',
    'spotify:timed-interruption-ended\x1f32\x1f20000',
    'spotify:timed-started\x1f32\x1f180000',
  ]);
});

test('a concrete wrong track cancels a provisional advertisement interruption', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f33');
  h.setTrack('/track/A', 'Target A');
  h.media.duration = 180;
  h.media.currentTime = 10;
  h.media.paused = false;
  h.dispatch('playing');

  h.advanceTime(1_000);
  h.setTrack(null, '');
  h.navigator.mediaSession.metadata.title = 'Advertisement';
  h.dispatch('playing');

  h.advanceTime(5_000);
  h.setTrack('/track/B', 'Wrong B');
  h.navigator.mediaSession.metadata.title = 'Wrong B';
  h.dispatch('playing');

  h.advanceTime(10_000);
  h.setTrack('/track/A', 'Target A');
  h.navigator.mediaSession.metadata.title = 'Target A';
  h.dispatch('playing');

  assert.deepEqual(h.messages, [
    'spotify:timed-started\x1f33\x1f170000',
    'spotify:timed-interruption-started\x1f33',
    'spotify:timed-interruption-cancelled\x1f33',
  ]);
});

test('validated requested-track ended publishes one advisory shortening event', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f34');
  h.setTrack('/track/A', 'Target A');
  h.media.duration = 180;
  h.media.currentTime = 179;
  h.media.paused = false;
  h.dispatch('playing');
  h.media.ended = true;
  h.dispatch('ended');

  assert.deepEqual(h.messages, [
    'spotify:timed-started\x1f34\x1f1000',
    'spotify:timed-ended\x1f34',
  ]);
});

test('observer has no heartbeat recovery or completion-planner API', () => {
  const h = createHarness();
  const runtime = h.window.__homePanelSpotifyMediaObserverRuntime;
  assert.equal(runtime.requestRecovery, undefined);
  assert.equal(runtime.scheduleRecovery, undefined);
  assert.equal(runtime.startHeartbeat, undefined);
  assert.equal(runtime.stopHeartbeat, undefined);
  assert.equal(runtime.postCompletionPlan, undefined);
  assert.equal(runtime.clearCompletionPlan, undefined);
  assert.equal(runtime.probeCompletion, undefined);
  assert.equal('heartbeatTimer' in runtime, false);
  assert.equal('recoveryPosted' in runtime.state, false);
  assert.equal('restartPending' in runtime.state, false);
  assert.equal('started' in runtime.state, false);

  for (const type of ['timeupdate', 'seeking', 'seeked', 'waiting', 'stalled', 'pause']) {
    assert.equal(h.documentListeners.has(type), false);
  }
  assert.equal(h.documentListeners.has('ended'), true);
});
