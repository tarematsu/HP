import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const runtimeSource = readFileSync(
  new URL('../../native/src/spotify_media_observer_runtime.inc', import.meta.url),
  'utf8',
);

function rawRuntimeScript() {
  const symbol = 'kSpotifyMediaObserverRuntimeScript';
  const prefix = `constexpr wchar_t ${symbol}[] = LR"JS(\n`;
  const start = runtimeSource.indexOf(prefix);
  assert.notEqual(start, -1, `${symbol} raw string not found`);
  const bodyStart = start + prefix.length;
  const end = runtimeSource.indexOf('\n)JS";', bodyStart);
  assert.notEqual(end, -1, `${symbol} raw string terminator not found`);
  return runtimeSource.slice(bodyStart, end);
}

class FakeMedia {
  paused = false;
  ended = false;
  currentTime = 12;
}

test('same-generation recovery posts a fresh timed-started after playback resumes', () => {
  const messages = [];
  const hostListeners = [];
  const media = new FakeMedia();
  const currentTrack = {
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
          if (type === 'message') hostListeners.push(handler);
        },
      },
    },
  };
  const document = {
    querySelector() {
      return currentTrack;
    },
  };
  const context = vm.createContext({
    window,
    document,
    navigator: { mediaSession: { metadata: { title: 'Target A' } } },
    HTMLMediaElement: FakeMedia,
    location: { href: 'https://open.spotify.com/track/A' },
    URL,
    String,
    Number,
    setTimeout() { return 1; },
    clearTimeout() {},
  });
  vm.runInContext(rawRuntimeScript(), context);

  for (const listener of hostListeners) {
    listener({ data: 'spotify:generation\x1f41' });
  }

  const runtime = window.__homePanelSpotifyMediaObserverRuntime;
  assert.ok(runtime);
  assert.equal(runtime.enforceTarget(media), 'playing');
  assert.equal(messages.at(-1), 'spotify:timed-started\x1f41');

  assert.equal(runtime.requestRecovery(media), true);
  assert.equal(messages.at(-1), 'spotify:not-playing\x1f41');
  assert.equal(runtime.state.restartPending, true);

  assert.equal(runtime.enforceTarget(media), 'playing');
  assert.equal(messages.at(-1), 'spotify:timed-started\x1f41');
  assert.equal(
    messages.filter(message => message === 'spotify:timed-started\x1f41').length,
    2,
  );
  assert.equal(runtime.state.restartPending, false);
  assert.equal(runtime.state.recoveryPosted, false);
});
