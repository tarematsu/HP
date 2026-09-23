import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const native = readFileSync(new URL(
  '../../native/src/renderer_panels/media_tver_control_recovery.inc', import.meta.url), 'utf8');
const script = native.match(/LR"JS\(([\s\S]*?)\)JS"\s*$/)?.[1]
  ?.replaceAll(')JS" LR"JS(', '');
assert.ok(script, 'extract the JavaScript executed by the TVer WebView');

function playerScenario(duration, controls = [], portalOptions = [], dialogs = []) {
  let clock = 1000;
  const messages = [];
  let handlers = new Map();
  const player = { querySelectorAll: () => controls };
  let video = {
    isConnected: true, disabled: false, currentSrc: 'program-or-ad',
    duration, currentTime: 0, playbackRate: 1.75, defaultPlaybackRate: 1,
    muted: false, volume: 1, paused: false, ended: false,
    closest: () => player, parentElement: player,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 640, height: 360 }),
    addEventListener: (name, callback) => handlers.set(name, callback),
  };
  const document = {
    querySelectorAll: selector => selector === 'video' ? [video]
      : selector === '[role="dialog"]' ? dialogs
      : selector.includes('[role="menu"]') ? portalOptions : [],
    addEventListener: () => {}, elementFromPoint: () => portalOptions[0] || controls[0] || null,
    fullscreenElement: null,
  };
  const window = { chrome: { webview: { postMessage: value => messages.push(value) } } };
  const context = vm.createContext({
    window, document, location: {
      hostname: 'tver.jp', pathname: '/episodes/test',
      href: 'https://tver.jp/episodes/test', origin: 'https://tver.jp',
    },
    history: { pushState() {}, replaceState() {} },
    Date: { now: () => clock },
    getComputedStyle: element => ({
      display: element.hidden ? 'none' : 'block',
      visibility: 'visible', opacity: element.opacity ?? '1',
    }),
    MutationObserver: class { observe() {} disconnect() {} },
    AbortController, Element: class {},
    setTimeout: () => 1, clearTimeout: () => {},
    innerWidth: 640, innerHeight: 360,
  });
  return {
    get video() { return video; }, messages, window,
    removeDialog: dialog => {
      const index = dialogs.indexOf(dialog);
      if (index !== -1) dialogs.splice(index, 1);
    },
    run: () => vm.runInContext(script, context),
    ended: () => handlers.get('ended')?.({ type: 'ended' }),
    advance: ms => { clock += ms; },
    replaceVideo: () => {
      handlers = new Map();
      video = { ...video, currentTime: 0, ended: false };
    },
  };
}

test('required questionnaire stays visible and playback waits for an answer', () => {
  const dialog = {
    querySelector: selector => selector.includes('questionnaire-') ? {} : null,
    getAttribute: () => null, textContent: 'アンケート 回答後に再生 閉じる',
  };
  const scene = playerScenario(1800, [], [], [dialog]);
  scene.video.playbackRate = 1;
  const removed = [];
  scene.window.__homePanelTverRuntime = {
    viewportPlayer: { removeAttribute: name => removed.push(name) },
    viewportAncestors: [{ removeAttribute: name => removed.push(name) }],
  };
  const action = scene.run();
  assert.equal(action, 'recovery');
  assert.equal(scene.video.playbackRate, 1);
  assert.deepEqual(scene.messages, ['homepanel:tver-media-init']);
  assert.deepEqual(removed, [
    'data-homepanel-tver-fill', 'data-homepanel-tver-fill-ancestor',
  ]);
  scene.removeDialog(dialog);
  scene.run();
  assert.equal(scene.video.playbackRate, 1.75);
  assert.equal(scene.messages.filter(value => value === 'homepanel:tver-media-init').length, 1);
  assert.equal(scene.messages.includes('homepanel:tver-fullscreen-key'), true);
});

test('a short pre-roll with inherited 1.75x cannot advance the episode', () => {
  const scene = playerScenario(8);
  scene.run();
  scene.video.currentTime = 8;
  scene.video.ended = true;
  scene.ended();
  scene.run();
  assert.equal(scene.messages.includes('homepanel:tver-ended'), false);
});

test('a hidden ad skip control cannot suppress program setup or receive a click', () => {
  const skip = {
    isConnected: true, disabled: false, hidden: true,
    getAttribute: name => name === 'aria-label' ? '広告をスキップ' : null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 80, height: 30 }),
  };
  const scene = playerScenario(1800, [skip]);
  scene.video.playbackRate = 1;
  const action = scene.run();
  assert.equal(scene.video.playbackRate, 1.75);
  assert.equal(scene.messages.includes('homepanel:tver-fullscreen-key'), true);
  assert.equal(Array.isArray(action), false);
});

test('an ad skip control inside a transparent parent is not an active ad', () => {
  const skip = {
    isConnected: true, disabled: false,
    parentElement: { opacity: '0', parentElement: null, getAttribute: () => null },
    getAttribute: name => name === 'aria-label' ? '広告をスキップ' : null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 80, height: 30 }),
  };
  const scene = playerScenario(1800, [skip]);
  scene.video.playbackRate = 1;
  scene.run();
  assert.equal(scene.video.playbackRate, 1.75);
});

test('program speed applies and fullscreen retries even when fullscreen is refused', () => {
  const scene = playerScenario(1800);
  scene.video.playbackRate = 1;
  scene.run();
  assert.equal(scene.video.playbackRate, 1.75);
  assert.equal(scene.messages.filter(value => value === 'homepanel:tver-fullscreen-key').length, 1);
  scene.advance(5000);
  scene.run();
  assert.equal(scene.messages.filter(value => value === 'homepanel:tver-fullscreen-key').length, 2);
  assert.equal(scene.window.__homePanelTverRuntime.qualityApplied, false);
});

test('a long program cannot advance after ten seconds or a source replacement', () => {
  const scene = playerScenario(120);
  scene.run();
  scene.video.currentTime = 2;
  scene.advance(2000);
  scene.run();
  scene.video.currentTime = 120;
  scene.advance(6000);
  scene.ended();
  scene.run();
  assert.equal(scene.messages.includes('homepanel:tver-ended'), false);
  scene.video.currentSrc = 'next-source';
  scene.run();
  assert.equal(scene.window.__homePanelTverRuntime.programEndPending, false);
});

test('quality menu is retried past four attempts without claiming low quality', () => {
  const properties = new Map();
  const menu = {
    isConnected: true, disabled: false, parentElement: null,
    getAttribute: key => key === 'aria-label' ? '画質' : null,
    removeAttribute() {}, addEventListener() {}, removeEventListener() {},
    contains: element => element === menu,
    getBoundingClientRect: () => ({ left: 10, top: 10, width: 40, height: 40 }),
    style: {
      cssText: '',
      getPropertyValue: key => properties.get(key) || '',
      getPropertyPriority: () => '',
      setProperty: (key, value) => properties.set(key, value),
      removeProperty: key => properties.delete(key),
    },
  };
  const scene = playerScenario(1800, [menu]);
  for (let attempt = 0; attempt < 6; attempt++) {
    scene.run();
    scene.advance(2000);
  }
  assert.equal(scene.window.__homePanelTverRuntime.qualityApplied, false);
  assert.ok(scene.window.__homePanelTverRuntime.qualityLastAttemptAt > 9000);
});

test('settings menu finds low quality when TVer portals its options outside the player', () => {
  const makeControl = label => ({
    isConnected: true, disabled: false, parentElement: null,
    getAttribute: name => name === 'aria-label' ? label : null,
    removeAttribute() {}, addEventListener() {}, removeEventListener() {},
    contains: () => false,
    getBoundingClientRect: () => ({ left: 10, top: 10, width: 40, height: 40 }),
    style: {
      cssText: '', getPropertyValue: () => '', getPropertyPriority: () => '',
      setProperty() {}, removeProperty() {},
    },
  });
  const settings = makeControl('設定');
  const low = makeControl('低');
  const scene = playerScenario(1800, [settings], [low]);
  assert.equal(Array.isArray(scene.run()), true);
  scene.advance(2000);
  assert.equal(Array.isArray(scene.run()), true);
  assert.equal(scene.window.__homePanelTverRuntime.qualityApplied, false);
  low.getAttribute = name => name === 'aria-label' ? '低'
    : name === 'aria-checked' ? 'true' : null;
  scene.advance(2000);
  scene.run();
  assert.equal(scene.window.__homePanelTverRuntime.qualityApplied, true);
});

test('replacement video with the same source starts fresh program completion state', () => {
  const scene = playerScenario(120);
  scene.run();
  scene.video.currentTime = 2;
  scene.advance(31000);
  scene.run();
  assert.equal(scene.window.__homePanelTverRuntime.programKey, scene.video.currentSrc);
  scene.replaceVideo();
  scene.run();
  assert.equal(scene.window.__homePanelTverRuntime.programKey, '');
  scene.video.currentTime = 120;
  scene.video.ended = true;
  scene.ended();
  scene.run();
  assert.equal(scene.messages.includes('homepanel:tver-ended'), false);
});
