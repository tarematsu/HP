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
  assert.equal(chunks.length, 1, 'simple scoped reconcile raw string not found');
  return chunks[0];
}

function fakeButton(label, visible = false) {
  return {
    disabled: false,
    isConnected: true,
    __visible: visible,
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

function makeScopedContext({
  pageButtons = [],
  playerButtons = [],
  mediaElements = [],
  currentTrack = null,
  metadataTitle = '',
  advertisementVisible = false,
} = {}) {
  const window = {
    __homePanelSpotifyNativeTarget: { path: '/track/A', title: 'Target A' },
    __homePanelSpotifyNativeLoadedAt: Date.now() - 2000,
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
  const adElement = { isConnected: true };
  const document = {
    querySelectorAll(selector) {
      if (selector === 'button[data-testid="play-button"]') return pageButtons;
      if (selector === 'button[data-testid="control-button-playpause"]') {
        return playerButtons;
      }
      if (selector === 'audio, video') return mediaElements;
      if (selector.includes('[role="alertdialog"]')) return [];
      return [];
    },
    querySelector(selector) {
      if (selector.includes('/track/')) return currentTrack;
      if (advertisementVisible &&
          (selector.includes('ad-banner') || selector.includes('advertisement') ||
           selector.includes('sponsored') || selector.includes('/ad/'))) {
        return adElement;
      }
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
  return { context, window };
}

function runScoped(options = {}) {
  const { context } = makeScopedContext(options);
  return vm.runInContext(rawScopedScript(), context);
}

function runScopedTwice(options = {}, advanceBy = 0.2) {
  const { context } = makeScopedContext(options);
  const first = vm.runInContext(rawScopedScript(), context);
  for (const media of options.mediaElements || []) media.currentTime += advanceBy;
  const second = vm.runInContext(rawScopedScript(), context);
  return [first, second];
}

test('active music reconcile directly uses one scoped playback script', () => {
  assert.match(wrapper, /#include "spotify_scoped_track_reconcile\.inc"/);
  assert.doesNotMatch(wrapper, /spotify_strict_track_start_reconcile/);
  assert.match(music, /ExecuteScript\(\s*kSpotifyScopedTrackReconcileScript/);
  assert.doesNotMatch(wrapper, /#define kSpotifyScopedTrackReconcileScript/);
});

test('target URL stays authoritative while playback identity uses track path or media session', () => {
  assert.match(scoped, /location\.hostname !== 'open\.spotify\.com'/);
  assert.match(scoped, /location\.pathname === targetPath/);
  assert.match(scoped, /targetPath\.startsWith\('\/track\/'\)/);
  assert.match(scoped, /observedTrackPath/);
  assert.match(scoped, /now-playing-widget/);
  assert.match(scoped, /navigator\.mediaSession/);
  assert.match(scoped, /const targetMatches = observedTrackPath/);
});

test('normal Spotify Play uses the target-page button once', () => {
  const result = runScoped({ pageButtons: [fakeButton('Play', true)] });
  assert.equal(Array.isArray(result), true);
  assert.equal(result[0], 14);
  assert.equal(result[1], 14);
  assert.match(scoped, /state\.playIssued = true/);
  assert.doesNotMatch(scoped, /button\.click\(\)|ZeroSecondRestartPath/);
});

test('target identity alone does not confirm playback without media progress', () => {
  assert.equal(runScoped({
    currentTrack: { href: 'https://open.spotify.com/track/A' },
  }), 2000);
});

test('matching target confirms only after the same media clock advances', () => {
  const media = fakeMedia(0.5, false);
  const [first, second] = runScopedTwice({
    mediaElements: [media],
    currentTrack: { href: 'https://open.spotify.com/track/A' },
  });
  assert.equal(first, 2000);
  assert.equal(second, true);
});

test('progressing wrong track is left alone instead of restarted', () => {
  const media = fakeMedia(1.0, false);
  assert.equal(runScoped({
    mediaElements: [media],
    currentTrack: { href: 'https://open.spotify.com/track/B' },
    metadataTitle: 'Target A',
  }), 2000);
  assert.doesNotMatch(scoped, /WrongTrackRecovery|pagePause|return 'restart'/);
});

test('advertisement playback is left alone', () => {
  assert.equal(runScoped({
    mediaElements: [fakeMedia(2.0, false)],
    advertisementVisible: true,
  }), 2000);
  assert.match(scoped, /advertisementVisible \|\| \(activeMedia && !targetMatches\)/);
});

test('Media Session title plus advancing media can confirm compact-layout playback', () => {
  const media = fakeMedia(0.5, false);
  const [first, second] = runScopedTwice({
    mediaElements: [media],
    metadataTitle: 'Target A',
  });
  assert.equal(first, 2000);
  assert.equal(second, true);
});

test('global Play is allowed only when Media Session already identifies the target', () => {
  assert.equal(runScoped({
    playerButtons: [fakeButton('Play', true)],
    currentTrack: { href: 'https://open.spotify.com/track/A' },
  }), 2000);

  const result = runScoped({
    playerButtons: [fakeButton('Play', true)],
    metadataTitle: 'Target A',
  });
  assert.equal(Array.isArray(result), true);
  assert.deepEqual([...result], [14, 14]);
});

test('observer runtime still tolerates localized Spotify track paths for confirmation', () => {
  assert.match(observerRuntime, /const sameTrackPath =/);
  assert.match(observerRuntime, /value\.endsWith\(expected\)/);
});
