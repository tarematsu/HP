import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const raw = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_current_player_settings.inc', import.meta.url),
  'utf8',
);
const script = [...raw.matchAll(/LR"JS\(([\s\S]*?)\)JS"/g)]
  .map(([, chunk]) => chunk).join('');

function scenario({ duration = 1800, quality = '低', speed = '×1.75',
                    initialRate = 1.75, ads = [], questionnaire = false,
                    videos = null } = {}) {
  let now = 1000;
  const counters = {
    controlQueries: 0, videoQueries: 0, adQueries: 0, dialogQueries: 0,
    videoRects: 0, mediaRateWrites: 0, defaultRateWrites: 0,
    controlTextReads: 0, controlRects: 0,
  };
  const makeControl = (label, role = 'button') => ({
    isConnected: true, disabled: false,
    get innerText() { counters.controlTextReads++; return label; },
    textContent: label,
    getAttribute: name => name === 'role' ? role : null,
    closest: () => null,
    getBoundingClientRect: () => {
      counters.controlRects++;
      return { left: 0, top: 0, width: 60, height: 24 };
    },
  });
  const speedIndicator = makeControl(speed);
  const qualityIndicator = makeControl(quality);
  const controls = [...ads, speedIndicator, qualityIndicator];
  const createVideo = (src = 'program', playing = true) => {
    let rate = initialRate;
    let defaultRate = initialRate;
    return {
      isConnected: true, duration, currentSrc: src, src,
      paused: !playing, ended: false, readyState: 4,
      get playbackRate() { return rate; },
      set playbackRate(value) { counters.mediaRateWrites++; rate = value; },
      get defaultPlaybackRate() { return defaultRate; },
      set defaultPlaybackRate(value) { counters.defaultRateWrites++; defaultRate = value; },
      getBoundingClientRect: () => {
        counters.videoRects++;
        return { left: 0, top: 0, width: 640, height: 360 };
      },
      setActualRate: value => { rate = value; },
    };
  };
  const videoElements = videos || [createVideo()];
  const messages = [];
  const document = {
    fullscreenElement: null, webkitFullscreenElement: null,
    msFullscreenElement: null,
    getElementById: () => null,
    querySelectorAll: selector => {
      if (selector === '[role="dialog"]') {
        counters.dialogQueries++;
        return questionnaire ? [{
          querySelector: () => ({}), textContent: 'アンケート',
        }] : [];
      }
      if (selector === 'video') { counters.videoQueries++; return videoElements; }
      if (selector.includes('[data-testid*="advert"')) {
        counters.adQueries++;
        return [];
      }
      counters.controlQueries++;
      return controls;
    },
  };
  const window = {
    chrome: { webview: { postMessage: message => messages.push(message) } },
  };
  const context = vm.createContext({
    window, document, location: {
      hostname: 'tver.jp', pathname: '/episodes/test',
    },
    Date: class extends Date { static now() { return now; } },
    getComputedStyle: () => ({
      display: 'block', visibility: 'visible', opacity: '1',
    }),
    setTimeout: () => 1,
    clearTimeout: () => {},
    HTMLMediaElement: undefined,
  });
  return {
    counters, controls, videoElements, window, messages, makeControl,
    run: () => vm.runInContext(script, context),
    advance: ms => { now += ms; },
  };
}

test('steady TVer playback scans settings once per probe and avoids redundant media writes', () => {
  const scene = scenario();
  scene.run();
  assert.equal(scene.counters.controlQueries, 1);
  assert.equal(scene.counters.videoRects, 1);
  assert.equal(scene.counters.mediaRateWrites, 0);
  assert.equal(scene.counters.defaultRateWrites, 0);
  assert.equal(scene.window.__homePanelTverRuntime.currentSettingsSpeedConfirmed, true);
  assert.equal(scene.window.__homePanelTverRuntime.currentSettingsQualityConfirmed, true);
  assert.deepEqual(scene.messages, ['homepanel:tver-fullscreen-key']);

  scene.advance(1000);
  scene.run();
  assert.equal(scene.counters.controlQueries, 2);
  assert.equal(scene.counters.videoRects, 2);
  assert.equal(scene.counters.mediaRateWrites, 0);
  assert.equal(scene.counters.defaultRateWrites, 0);
});

test('1.75x media is restored only when a site or ad resets it', () => {
  const scene = scenario({ initialRate: 1 });
  scene.run();
  assert.equal(scene.counters.mediaRateWrites, 1);
  assert.equal(scene.counters.defaultRateWrites, 1);
  scene.advance(1000);
  scene.run();
  assert.equal(scene.counters.mediaRateWrites, 1);
  assert.equal(scene.counters.defaultRateWrites, 1);
  scene.videoElements[0].setActualRate(1);
  scene.advance(1000);
  scene.run();
  assert.equal(scene.counters.mediaRateWrites, 2);
  assert.equal(scene.counters.defaultRateWrites, 1);
});

test('short ad bypasses settings discovery and rate mutation', () => {
  const scene = scenario({ duration: 8, initialRate: 1 });
  scene.run();
  assert.equal(scene.counters.controlQueries, 0);
  assert.equal(scene.counters.adQueries, 0);
  assert.equal(scene.counters.mediaRateWrites, 0);
  assert.equal(scene.counters.defaultRateWrites, 0);
  assert.equal(scene.window.__homePanelTverRuntime.currentSettingsSpeedConfirmed, false);
});

test('visible ad skip control blocks program-only settings without rechecking ad nodes', () => {
  const scene = scenario({ initialRate: 1 });
  const skip = scene.makeControl('広告をスキップ');
  scene.controls.unshift(skip);
  scene.run();
  assert.equal(scene.counters.controlQueries, 1);
  assert.equal(scene.counters.adQueries, 0);
  assert.equal(scene.counters.mediaRateWrites, 0);
  assert.equal(scene.counters.defaultRateWrites, 0);
  assert.equal(scene.counters.controlRects, 1);
});

test('questionnaire takes precedence without a global settings-control or video scan', () => {
  const scene = scenario({ questionnaire: true });
  scene.run();
  assert.equal(scene.counters.controlQueries, 0);
  assert.equal(scene.counters.videoQueries, 0);
  assert.equal(scene.counters.adQueries, 0);
});

test('video scoring reads each candidate rectangle just once', () => {
  const scene = scenario();
  const other = {
    isConnected: true, duration: 1800,
    currentSrc: 'stale', src: 'stale', paused: true, ended: false,
    readyState: 4,
    getBoundingClientRect: () => {
      scene.counters.videoRects++;
      return { width: 900, height: 500 };
    },
  };
  scene.videoElements.unshift(other);
  scene.run();
  assert.equal(scene.counters.videoRects, 2);
  assert.equal(scene.videoElements[1].playbackRate, 1.75);
});

test('settings hot path uses a single controls NodeList and no filtered candidate arrays', () => {
  assert.match(script, /for \(const element of document\.querySelectorAll\(controlSelector\)\)/);
  assert.doesNotMatch(script, /controls\.filter\(|controls\.some\(|Array\.from\(document\.querySelectorAll/);
  assert.match(script, /video\.playbackRate !== 1\.75/);
  assert.doesNotMatch(script, /videos\.reduce\(/);
});
