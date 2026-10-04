import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const native = readFileSync(new URL(
  '../../native/src/renderer_panels/media_tver_current_player_settings.inc', import.meta.url), 'utf8');
const script = Array.from(native.matchAll(/LR"JS\(([\s\S]*?)\)JS"/g), match => match[1]).join('');
assert.ok(script, 'extract current TVer player settings bridge');

function control(label, role = 'button', onClick = () => {}) {
  let currentLabel = label;
  const attributes = new Map([['role', role]]);
  return {
    isConnected: true,
    disabled: false,
    get innerText() { return currentLabel; },
    get textContent() { return currentLabel; },
    setLabel(value) { currentLabel = value; },
    setAttribute(name, value) { attributes.set(name, value); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    getBoundingClientRect: () => ({ left: 10, top: 10, width: 40, height: 24 }),
    closest: selector => role === 'menuitemradio' && selector.includes('[role="menu"]')
      ? { isConnected: true }
      : null,
    click() { onClick(this); },
  };
}

function video({ playing = true, width = 640, height = 360, src = 'program' } = {}) {
  return {
    isConnected: true,
    disabled: false,
    currentSrc: src,
    src,
    duration: 1800,
    currentTime: 30,
    playbackRate: 1,
    defaultPlaybackRate: 1,
    paused: !playing,
    ended: false,
    readyState: 4,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
  };
}

function scenario({ videos = [video()] } = {}) {
  let clock = 1000;
  let speedMenu = false;
  let qualityMenu = false;
  const messages = [];
  const speedIndicator = control('×1.0', 'button', () => { speedMenu = true; });
  const qualityIndicator = control('自動', 'button', () => { qualityMenu = true; });
  const speed175 = control('×1.75', 'menuitemradio', element => {
    element.setAttribute('aria-checked', 'true');
    speedIndicator.setLabel('×1.75');
    speedMenu = false;
  });
  const low = control('低', 'menuitemradio', element => {
    element.setAttribute('aria-checked', 'true');
    qualityIndicator.setLabel('低');
    qualityMenu = false;
  });
  const controls = () => [
    speedIndicator,
    qualityIndicator,
    ...(speedMenu ? [speed175] : []),
    ...(qualityMenu ? [low] : []),
  ];
  const document = {
    fullscreenElement: null,
    webkitFullscreenElement: null,
    msFullscreenElement: null,
    getElementById: () => null,
    querySelectorAll(selector) {
      if (selector === 'video') return videos;
      if (selector === '[role="dialog"]') return [];
      if (selector.includes('[data-testid*="advert"')) return [];
      return controls();
    },
  };
  const window = {
    chrome: { webview: { postMessage: message => messages.push(message) } },
  };
  const context = vm.createContext({
    window,
    document,
    location: { hostname: 'tver.jp', pathname: '/episodes/test' },
    Date: class extends Date { static now() { return clock; } },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    setTimeout: () => 1,
    clearTimeout: () => {},
    HTMLMediaElement: undefined,
    innerWidth: 640,
    innerHeight: 360,
  });
  return {
    window,
    document,
    messages,
    speedIndicator,
    qualityIndicator,
    speed175,
    low,
    videos,
    run: () => vm.runInContext(script, context),
    advance: ms => { clock += ms; },
  };
}

test('redesigned TVer UI is synchronized to 1.75x and low before fullscreen', () => {
  const scene = scenario();

  scene.run();
  assert.equal(scene.videos[0].playbackRate, 1.75);
  assert.equal(scene.speedIndicator.innerText, '×1.0');
  assert.equal(scene.messages.includes('homepanel:tver-fullscreen-key'), false);

  scene.advance(1000);
  scene.run();
  assert.equal(scene.speedIndicator.innerText, '×1.75');
  assert.equal(scene.messages.includes('homepanel:tver-fullscreen-key'), false);

  scene.advance(1000);
  scene.run();
  assert.equal(scene.qualityIndicator.innerText, '自動');

  scene.advance(1000);
  scene.run();
  assert.equal(scene.qualityIndicator.innerText, '低');

  scene.advance(1000);
  scene.run();
  assert.equal(scene.window.__homePanelTverRuntime.currentSettingsSpeedConfirmed, true);
  assert.equal(scene.window.__homePanelTverRuntime.currentSettingsQualityConfirmed, true);
  assert.equal(scene.window.__homePanelTverRuntime.qualityApplied, true);
  assert.equal(scene.messages.filter(
    value => value === 'homepanel:tver-fullscreen-key').length, 1);
});

test('active playing video wins over a stale first video', () => {
  const stale = video({ playing: false, width: 800, height: 450, src: 'stale' });
  const active = video({ playing: true, width: 640, height: 360, src: 'active' });
  const scene = scenario({ videos: [stale, active] });

  scene.run();
  assert.equal(active.playbackRate, 1.75);
  assert.equal(active.defaultPlaybackRate, 1.75);
  assert.equal(stale.playbackRate, 1);
});

test('current player bridge recognizes menuitemradio and avoids blind corner fullscreen', () => {
  assert.match(native, /\[role="menuitemradio"\]/);
  assert.match(native, /currentSettingsSpeedConfirmed/);
  assert.match(native, /currentSettingsQualityConfirmed/);
  assert.match(native, /homepanel:tver-fullscreen-key/);
  assert.match(native, /Runtime\.evaluate\(userGesture=true\)/);
  assert.doesNotMatch(native, /rect\.right\s*-\s*12/);
});