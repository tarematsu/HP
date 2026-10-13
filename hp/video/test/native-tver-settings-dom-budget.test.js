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

test('TVer settings retry coalesces wakeups without delaying an earlier recovery', () => {
  const begin = script.indexOf('  const schedule = (delay = 700) => {');
  const end = script.indexOf('  const connected =', begin);
  assert.ok(begin >= 0 && end > begin);
  const snippet = script.slice(begin, end);
  const state = {};
  let now = 1000;
  let nextId = 0;
  let installed = 0;
  const pending = new Map();
  const messages = [];
  const context = vm.createContext({
    state, post: message => messages.push(message),
    Date: class extends Date { static now() { return now; } },
    setTimeout: (callback, delay) => {
      installed++;
      const id = ++nextId;
      pending.set(id, { callback, delay });
      return id;
    },
    clearTimeout: id => pending.delete(id),
  });
  const schedule = delay => vm.runInContext(
    '(() => { const now = Date.now(); ' + snippet + ' return schedule; })()',
    context,
  )(delay);

  schedule(900);
  now += 100;
  schedule(900);
  assert.equal(installed, 1, 'a later retry must reuse the earliest timer');
  now += 100;
  schedule(280);
  assert.equal(installed, 2, 'urgent recovery must preempt the old timer');
  assert.equal(pending.size, 1);
  now += 100;
  schedule(900);
  assert.equal(installed, 2, 'a follow-up cannot postpone the urgent wake');
  const callback = [...pending.values()][0].callback;
  pending.clear();
  callback();
  assert.deepEqual(messages, ['homepanel:tver-wake']);
  assert.equal(state.currentSettingsWakeTimer, null);
  assert.equal(state.currentSettingsWakeDueAt, 0);
  schedule(900);
  assert.equal(installed, 3, 'a fired timer must allow a new recovery request');
});

test('steady TVer playback scans settings once per probe and avoids redundant media writes', () => {
  const scene = scenario();
  scene.run();
  assert.equal(scene.counters.controlQueries, 1);
  assert.equal(scene.counters.videoRects, 0);
  assert.equal(scene.counters.mediaRateWrites, 0);
  assert.equal(scene.counters.defaultRateWrites, 0);
  assert.equal(scene.window.__homePanelTverRuntime.currentSettingsSpeedConfirmed, true);
  assert.equal(scene.window.__homePanelTverRuntime.currentSettingsQualityConfirmed, true);
  assert.deepEqual(scene.messages, ['homepanel:tver-fullscreen-key']);

  scene.advance(1000);
  scene.run();
  assert.equal(scene.counters.controlQueries, 1,
    'confirmed playback should reuse the previous settings scan');
  assert.equal(scene.counters.videoRects, 0);
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

test('unrelated TVer controls do not trigger rendered-text layout reads', () => {
  const scene = scenario();
  const unrelated = Array.from({ length: 120 },
    () => scene.makeControl('再生'));
  scene.controls.unshift(...unrelated);
  scene.run();
  assert.equal(scene.counters.controlQueries, 1);
  assert.equal(scene.counters.controlTextReads, 2);
  assert.equal(scene.window.__homePanelTverRuntime.currentSettingsSpeedConfirmed, true);
  assert.equal(scene.window.__homePanelTverRuntime.currentSettingsQualityConfirmed, true);
});

test('TVer ad classification still checks rendered labels for relevant controls', () => {
  const scene = scenario({ initialRate: 1 });
  scene.controls.unshift(scene.makeControl('広告をスキップ'));
  scene.run();
  assert.equal(scene.counters.adQueries, 0);
  assert.equal(scene.counters.mediaRateWrites, 0);
  assert.equal(scene.counters.controlTextReads, 1);
});

test('single TVer video bypasses geometry ranking without changing selection', () => {
  const scene = scenario();
  scene.run();
  assert.equal(scene.counters.videoQueries, 1);
  assert.equal(scene.counters.videoRects, 0);
  assert.equal(scene.counters.controlQueries, 1);
  assert.equal(scene.window.__homePanelTverRuntime.currentSettingsSpeedConfirmed, true);
});

test('disconnected single TVer video is not treated as playable', () => {
  const scene = scenario();
  scene.videoElements[0].isConnected = false;
  scene.run();
  assert.equal(scene.counters.videoRects, 0);
  assert.equal(scene.counters.controlQueries, 0);
  assert.equal(scene.messages.includes('homepanel:tver-fullscreen-key'), false);
});


test('healthy TVer settings rescan after five seconds and whenever the media rate changes', () => {
  const scene = scenario();
  scene.run();
  assert.equal(scene.counters.controlQueries, 1);
  for (let index = 0; index < 4; index++) {
    scene.advance(1000);
    scene.run();
  }
  assert.equal(scene.counters.controlQueries, 1,
    'short healthy progress wakes must not rescan the player');
  scene.advance(1000);
  scene.run();
  assert.equal(scene.counters.controlQueries, 2,
    'a five-second fallback must still validate the site UI');

  scene.videoElements[0].setActualRate(1);
  scene.advance(100);
  scene.run();
  assert.equal(scene.counters.controlQueries, 3,
    'unexpected media rate changes must be handled without a wait');
  assert.equal(scene.videoElements[0].playbackRate, 1.75);
  assert.equal(scene.counters.mediaRateWrites, 1);
});

test('new media source and paused playback bypass the healthy settings cache', () => {
  const scene = scenario();
  scene.run();
  scene.videoElements[0].currentSrc = 'new-program';
  scene.advance(100);
  scene.run();
  assert.equal(scene.counters.controlQueries, 2,
    'a new source must revalidate settings even inside the five-second window');

  scene.videoElements[0].paused = true;
  scene.advance(100);
  scene.run();
  assert.equal(scene.counters.controlQueries, 3,
    'paused playback must retain the immediate recovery path');
});

test('healthy TVer settings do not postpone fullscreen recovery', () => {
  const scene = scenario();
  scene.run();
  assert.deepEqual(scene.messages, ['homepanel:tver-fullscreen-key']);
  scene.advance(1000);
  scene.run();
  assert.equal(scene.counters.controlQueries, 1);
  scene.advance(2100);
  scene.run();
  assert.equal(scene.messages.filter(
    message => message === 'homepanel:tver-fullscreen-key').length, 2,
    'fullscreen retries must remain independent of the settings scan budget');
});


test('confirmed TVer playback limits duplicate questionnaire queries to one per three seconds', () => {
  const scene = scenario();
  scene.run();
  assert.equal(scene.counters.dialogQueries, 1);
  scene.advance(1000);
  scene.run();
  assert.equal(scene.counters.dialogQueries, 1,
    'unchanged confirmed settings should not scan global dialogs on each wake');
  scene.advance(2100);
  scene.run();
  assert.equal(scene.counters.dialogQueries, 2,
    'the periodic fallback must still detect newly opened questionnaires');
  scene.window.__homePanelTverRuntime.questionnaireActive = true;
  scene.advance(100);
  scene.run();
  assert.equal(scene.counters.dialogQueries, 3,
    'an active questionnaire reported by the playback controller must bypass the cache');
});

test('unconfirmed TVer settings always scan blocking questionnaires', () => {
  const scene = scenario({ speed: '×1.0', quality: '自動' });
  scene.run();
  assert.equal(scene.counters.dialogQueries, 1);
  scene.advance(100);
  scene.run();
  assert.equal(scene.counters.dialogQueries, 2,
    'setup and recovery screens must not inherit the healthy playback throttle');
});
