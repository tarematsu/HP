import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const scripts = readFileSync(
  new URL('../../native/src/spotify_static_scripts.inc', import.meta.url),
  'utf8',
);
const music = readFileSync(
  new URL('../../native/src/spotify_music_target.inc', import.meta.url),
  'utf8',
);

const bootstrapMatch = scripts.match(
  /constexpr wchar_t kSpotifyStaticPageBootstrapScript\[\] = LR"JS\(([\s\S]*?)\)JS";/,
);
assert.ok(bootstrapMatch, 'Spotify page bootstrap script must be extractable');
const bootstrap = bootstrapMatch[1];

function createBootstrapHarness() {
  let messageHandler = null;
  const media = {
    pauseCalls: 0,
    pause() {
      this.pauseCalls += 1;
    },
  };
  const document = {
    getElementById(id) {
      return id === '__homePanelSpotifyStaticLightweight' ? {} : null;
    },
    querySelectorAll(selector) {
      return selector === 'audio, video' ? [media] : [];
    },
  };
  const window = {
    chrome: {
      webview: {
        addEventListener(type, handler) {
          assert.equal(type, 'message');
          messageHandler = handler;
        },
      },
    },
  };

  runInNewContext(bootstrap, { document, window });
  assert.ok(messageHandler, 'bootstrap must install the native target message bridge');

  return {
    media,
    window,
    sendTarget(path, title = 'track') {
      messageHandler({
        data: ['spotify:target', path, title].join('\u001f'),
      });
    },
  };
}

test('first target message initializes a fresh Spotify document without pausing media', () => {
  const harness = createBootstrapHarness();
  harness.sendTarget('/track/first', 'first');

  assert.equal(harness.media.pauseCalls, 0);
  assert.equal(harness.window.__homePanelSpotifyNativeTarget.path, '/track/first');
  assert.equal(harness.window.__homePanelSpotifyNativeTarget.title, 'first');
});

test('all target messages are declarative and never pause media in the page bridge', () => {
  const harness = createBootstrapHarness();
  harness.sendTarget('/track/first', 'first');
  harness.sendTarget('/track/first', 'first');
  harness.sendTarget('/track/second', 'second');

  assert.equal(harness.media.pauseCalls, 0);
  assert.equal(harness.window.__homePanelSpotifyNativeTarget.path, '/track/second');
  assert.doesNotMatch(bootstrap, /\.pause\s*\(/);
});

test('music transitions prefer a real Spotify SPA link and retain native navigation fallback', () => {
  assert.doesNotMatch(scripts, /kSpotifyStaticStopPlaybackScript/);
  assert.doesNotMatch(music, /kSpotifyStaticStopPlaybackScript/);
  assert.match(scripts, /kSpotifySpaRouteScript/);
  assert.match(scripts, /link\.click\(\)/);
  assert.match(music, /ExecuteScript\(\s*kSpotifySpaRouteScript/);
  assert.match(music, /Navigate\(currentTrack->url\.c_str\(\)\)/);
  assert.doesNotMatch(scripts + music, /TalkAbout|TALKABOUT|SpotifyPodcast|podcast/);
});
