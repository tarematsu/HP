import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const wrapper = source('spotify_webviews.inc');
const scoped = source('spotify_scoped_track_reconcile.inc');
const music = source('spotify_music_target.inc');
const observerRuntime = source('spotify_media_observer_runtime.inc');

function rawScopedScript() {
  const chunks = [...scoped.matchAll(/LR"JS\(\n([\s\S]*?)\n\)JS"/g)]
    .map(match => match[1]);
  assert.ok(chunks.length >= 2, 'scoped reconcile raw string chunks not found');
  return chunks.join('\n');
}

function fakeButton(label, visible = false) {
  return {
    disabled: false,
    isConnected: true,
    __visible: visible,
    __clicked: false,
    getAttribute(name) {
      if (name === 'aria-disabled') return 'false';
      if (name === 'aria-label') return label;
      return null;
    },
    getBoundingClientRect() {
      return visible
        ? { left: 4, top: 4, width: 20, height: 20 }
        : { left: 0, top: 0, width: 0, height: 0 };
    },
    scrollIntoView() {},
    click() { this.__clicked = true; },
  };
}

function fakeMedia(currentTime = 0.5, paused = false) {
  return {
    isConnected: true,
    ended: false,
    paused,
    currentTime,
  };
}

function runScoped({
  pageButtons = [],
  playerButtons = [],
  mediaElements = [],
  currentTrack = null,
  metadataTitle = '',
  restartPending = false,
} = {}) {
  const window = {
    __homePanelSpotifyNativeTarget: { path: '/track/A', title: 'Target A' },
    __homePanelSpotifyNativeLoadedAt: Date.now() - 2000,
    __homePanelSpotifyZeroSecondRestartPath: restartPending ? '/track/A' : null,
    innerWidth: 320,
    innerHeight: 180,
    getComputedStyle(element) {
      return {
        display: element.__visible ? 'block' : 'none',
        visibility: 'visible',
        pointerEvents: 'auto',
      };
    },
  };
  const document = {
    querySelectorAll(selector) {
      if (selector === 'button[data-testid="play-button"]') return pageButtons;
      if (selector === 'button[data-testid="control-button-playpause"]') {
        return playerButtons;
      }
      if (selector === 'audio, video') return mediaElements;
      return [];
    },
    querySelector(selector) {
      if (selector.includes('/track/')) return currentTrack;
      return null;
    },
  };
  const context = vm.createContext({
    window,
    document,
    navigator: { mediaSession: { metadata: metadataTitle ? { title: metadataTitle } : null } },
    location: {
      hostname: 'open.spotify.com',
      pathname: '/track/A',
      href: 'https://open.spotify.com/track/A',
    },
    URL,
    String,
    Number,
    Array,
    Date,
  });
  return vm.runInContext(rawScopedScript(), context);
}

test('active music reconcile directly uses the scoped playback script', () => {
  assert.match(wrapper, /#include "spotify_scoped_track_reconcile\.inc"/);
  assert.match(music, /ExecuteScript\(\s*kSpotifyScopedTrackReconcileScript/);
  assert.doesNotMatch(wrapper, /#define kSpotifyStaticTrackReconcileScript|#undef kSpotifyStaticTrackReconcileScript/);
  assert.doesNotMatch(music, /kSpotifyStaticTrackReconcileScript/);
});

test('target URL stays authoritative while global-player confirmation requires target identity', () => {
  assert.match(scoped, /location\.hostname !== 'open\.spotify\.com'/);
  assert.match(scoped, /location\.pathname === targetPath/);
  assert.match(scoped, /targetPath\.startsWith\('\/track\/'\)/);
  assert.match(scoped, /currentTrackMatchesTarget/);
  assert.match(scoped, /now-playing-widget/);
  assert.match(scoped, /navigator\.mediaSession/);
});

test('normal Spotify Play clicks use the visible target-page button', () => {
  assert.match(scoped, /button\[data-testid="play-button"\]/);
  assert.match(scoped, /button\[data-testid="control-button-playpause"\]/);
  assert.match(scoped, /const visiblePageButton = pageButtons\.find\(visible\)/);
  assert.match(scoped, /return point\(visiblePageButton\)/);
  assert.match(scoped, /playerPause && currentTrackMatchesTarget\(\)/);
  assert.doesNotMatch(scoped, /point\(playerPause\)|point\(playerButton\)/);
  assert.doesNotMatch(scoped, /querySelector\('audio'\)|audio\.play\(|direct-play|DirectPlay|buttonIntent|settling/);
});

test('hidden target-page Pause does not confirm playback without media-clock evidence', () => {
  assert.equal(runScoped({ pageButtons: [fakeButton('Pause', false)] }), 2000);
});

test('hidden target-page Pause confirms only when the media clock has advanced', () => {
  assert.equal(runScoped({
    pageButtons: [fakeButton('Pause', false)],
    mediaElements: [fakeMedia(0.5, false)],
  }), true);
});

test('global Pause with matching identity still requires media-clock evidence', () => {
  assert.equal(runScoped({
    playerButtons: [fakeButton('Pause', false)],
    currentTrack: {
      href: 'https://open.spotify.com/track/A',
      textContent: 'Target A',
    },
  }), 2000);
});

test('global Pause confirms background playback when identity and media progress both match', () => {
  assert.equal(runScoped({
    playerButtons: [fakeButton('Pause', false)],
    mediaElements: [fakeMedia(0.5, false)],
    currentTrack: {
      href: 'https://open.spotify.com/track/A',
      textContent: 'Target A',
    },
  }), true);
});

test('global Pause is rejected when now-playing track is a different song', () => {
  assert.equal(runScoped({
    playerButtons: [fakeButton('Pause', false)],
    currentTrack: {
      href: 'https://open.spotify.com/track/B',
      textContent: 'Other Track',
    },
    metadataTitle: 'Target A',
  }), null);
});

test('Media Session identity alone does not bypass media-clock evidence', () => {
  assert.equal(runScoped({
    playerButtons: [fakeButton('Pause', false)],
    metadataTitle: 'Target A',
  }), 2000);
});

test('Media Session title plus media progress can confirm compact-layout playback', () => {
  assert.equal(runScoped({
    playerButtons: [fakeButton('Pause', false)],
    mediaElements: [fakeMedia(0.5, false)],
    metadataTitle: 'Target A',
  }), true);
});

test('global Play is never returned during normal reconciliation', () => {
  assert.equal(runScoped({
    playerButtons: [fakeButton('Play', true)],
    currentTrack: {
      href: 'https://open.spotify.com/track/A',
      textContent: 'Target A',
    },
  }), null);
});

test('global Play is a recovery-only CDP target after a verified zero-second stall', () => {
  const result = runScoped({
    playerButtons: [fakeButton('Play', true)],
    currentTrack: {
      href: 'https://open.spotify.com/track/A',
      textContent: 'Target A',
    },
    restartPending: true,
  });
  assert.equal(Array.isArray(result), true);
  assert.equal(result[0], 14);
  assert.equal(result[1], 14);
});

test('global recovery Play is rejected when now-playing identity changed', () => {
  assert.equal(runScoped({
    playerButtons: [fakeButton('Play', true)],
    currentTrack: {
      href: 'https://open.spotify.com/track/B',
      textContent: 'Other Track',
    },
    restartPending: true,
  }), null);
});

test('observer runtime still tolerates localized Spotify track paths for confirmation', () => {
  assert.match(observerRuntime, /const sameTrackPath =/);
  assert.match(observerRuntime, /value\.endsWith\(expected\)/);
});
