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
  return observerModules.map(({ source, symbol }) => rawScript(source, symbol)).join(';\n') + ';';
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
  const media = new FakeMedia();
  const window = {
    __homePanelSpotifyNativeTarget: { path: '/track/A', title: 'Target A' },
    chrome: { webview: {
      postMessage(message) { messages.push(message); },
      addEventListener(type, handler) { if (type === 'message') webviewListeners.push(handler); },
    } },
  };
  const document = {
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(handler);
    },
    querySelector() { return currentTrack; },
    querySelectorAll(selector) { return selector === 'audio, video' ? [media] : []; },
  };
  const navigator = { mediaSession: { metadata: { title: '' } } };
  const context = vm.createContext({
    window, document, navigator, HTMLMediaElement: FakeMedia,
    location: { href: 'https://open.spotify.com/track/A' },
    URL, Number, Array, String, Date, Math,
    setTimeout(fn) { const id = nextTimer++; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(productionObserverScript(), context);
  const dispatch = (type, target = media) => {
    for (const handler of documentListeners.get(type) || []) handler({ target, type });
  };
  const hostMessage = data => { for (const handler of webviewListeners) handler({ data }); };
  const setTrack = (path, title) => {
    currentTrack = path ? { href: `https://open.spotify.com${path}`, textContent: title } : null;
  };
  const runTimers = () => {
    const pending = [...timers.values()];
    timers.clear();
    for (const fn of pending) fn();
  };
  return { window, navigator, media, messages, dispatch, hostMessage, setTrack, runTimers, documentListeners };
}

test('target identity and wrong-track rejection have one runtime owner', () => {
  const runtime = observerModules[0].source;
  const events = observerModules[1].source;
  assert.match(runtime, /const enforceTarget = media =>/);
  assert.match(runtime, /const scheduleTargetChecks = media =>/);
  assert.match(events, /scheduleTargetChecks\(event\.target\)/);
  assert.doesNotMatch(runtime + events, /requestRecovery|heartbeat|postCompletionPlan/);
});

test('observer prefers direct Track ID and reports remaining duration once', () => {
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

test('invalid duration waits until durationchange makes metadata usable', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f12');
  h.setTrack('/track/A', 'Target A');
  h.media.paused = false;
  h.dispatch('playing');
  assert.deepEqual(h.messages, []);
  h.media.duration = 181;
  h.media.currentTime = 1;
  h.dispatch('durationchange');
  assert.deepEqual(h.messages, ['spotify:timed-started\x1f12\x1f180000']);
});

test('trusted native Play establishes start only when concrete identity is absent', () => {
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
});

test('non-target playback after start emits one suspend and one resume deadline from remaining target duration', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f31');
  h.setTrack('/track/A', 'Target A');
  h.media.duration = 180;
  h.media.currentTime = 10;
  h.media.paused = false;
  h.dispatch('playing');
  h.setTrack(null, '');
  h.navigator.mediaSession.metadata.title = 'Advertisement';
  h.dispatch('playing');
  h.setTrack('/track/A', 'Target A');
  h.navigator.mediaSession.metadata.title = 'Target A';
  h.media.currentTime = 40;
  h.dispatch('playing');
  assert.deepEqual(h.messages, [
    'spotify:timed-started\x1f31\x1f170000',
    'spotify:timed-interrupted\x1f31',
    'spotify:timed-resumed\x1f31\x1f140000',
  ]);
});

test('non-target playback before target start does not create a separate interruption timer', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f32');
  h.setTrack(null, '');
  h.navigator.mediaSession.metadata.title = 'Advertisement';
  h.media.paused = false;
  h.dispatch('playing');
  assert.deepEqual(h.messages, []);
  h.setTrack('/track/A', 'Target A');
  h.navigator.mediaSession.metadata.title = 'Target A';
  h.media.duration = 181;
  h.media.currentTime = 1;
  h.dispatch('playing');
  assert.deepEqual(h.messages, ['spotify:timed-started\x1f32\x1f180000']);
});

test('concrete wrong playback after start remains a simple interruption until target resumes', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f33');
  h.setTrack('/track/A', 'Target A');
  h.media.duration = 180;
  h.media.currentTime = 10;
  h.media.paused = false;
  h.dispatch('playing');
  h.setTrack('/track/B', 'Wrong B');
  h.navigator.mediaSession.metadata.title = 'Wrong B';
  h.dispatch('playing');
  h.setTrack('/track/A', 'Target A');
  h.navigator.mediaSession.metadata.title = 'Target A';
  h.media.currentTime = 20;
  h.dispatch('playing');
  assert.deepEqual(h.messages, [
    'spotify:timed-started\x1f33\x1f170000',
    'spotify:timed-interrupted\x1f33',
    'spotify:timed-resumed\x1f33\x1f160000',
  ]);
});

test('validated requested-track ended publishes one advisory shortening event and later ads cannot suspend it', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f34');
  h.setTrack('/track/A', 'Target A');
  h.media.duration = 180;
  h.media.currentTime = 179;
  h.media.paused = false;
  h.dispatch('playing');
  h.media.ended = true;
  h.dispatch('ended');
  h.media.ended = false;
  h.setTrack('/track/B', 'Advertisement');
  h.navigator.mediaSession.metadata.title = 'Advertisement';
  h.dispatch('playing');
  assert.deepEqual(h.messages, [
    'spotify:timed-started\x1f34\x1f1000',
    'spotify:timed-ended\x1f34',
  ]);
});

test('sustained target pause promotes the slot into native recovery', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f35');
  h.setTrack('/track/A', 'Target A');
  h.media.duration = 180;
  h.media.currentTime = 10;
  h.media.paused = false;
  h.dispatch('playing');
  h.media.paused = true;
  h.dispatch('pause');
  assert.deepEqual(h.messages, ['spotify:timed-started\x1f35\x1f170000']);
  h.runTimers();
  assert.deepEqual(h.messages, [
    'spotify:timed-started\x1f35\x1f170000',
    'spotify:timed-interrupted\x1f35',
  ]);
});

test('brief buffering that resumes progress before grace does not interrupt', () => {
  const h = createHarness();
  h.hostMessage('spotify:generation\x1f36');
  h.setTrack('/track/A', 'Target A');
  h.media.duration = 180;
  h.media.currentTime = 10;
  h.media.paused = false;
  h.dispatch('playing');
  h.dispatch('waiting');
  h.media.currentTime = 11;
  h.dispatch('timeupdate');
  h.runTimers();
  assert.deepEqual(h.messages, ['spotify:timed-started\x1f36\x1f170000']);
});

test('observer has bounded playback-loss recovery but no heartbeat or completion planner', () => {
  const h = createHarness();
  const runtime = h.window.__homePanelSpotifyMediaObserverRuntime;
  assert.equal(runtime.requestRecovery, undefined);
  assert.equal(runtime.startHeartbeat, undefined);
  assert.equal(runtime.postCompletionPlan, undefined);
  assert.equal('interruptionStartedAt' in runtime.state, false);
  for (const type of ['seeking', 'seeked', 'play']) {
    assert.equal(h.documentListeners.has(type), false);
  }
  for (const type of [
    'playing', 'durationchange', 'loadedmetadata', 'canplay', 'timeupdate',
    'pause', 'waiting', 'stalled', 'error', 'ended',
  ]) {
    assert.equal(h.documentListeners.has(type), true);
  }
});
