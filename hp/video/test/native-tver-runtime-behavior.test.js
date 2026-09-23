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
  const stored = new Map();
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
      : selector === 'button[type="submit"][form]' ? submitButtons
      : selector.includes('[role="menu"]') ? portalOptions : [],
    addEventListener: () => {}, elementFromPoint: () => portalOptions[0] || controls[0] || null,
    fullscreenElement: null,
  };
  const submitButtons = [];
  const window = { chrome: { webview: { postMessage: value => messages.push(value) } } };
  const context = vm.createContext({
    window, document, localStorage: {
      getItem: key => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
    },
    HTMLInputElement: class { set value(value) { this._value = value; } get value() { return this._value || ''; } },
    Event: class { constructor(type, options) { this.type = type; this.bubbles = options.bubbles; } },
    location: {
      hostname: 'tver.jp', pathname: '/episodes/test',
      href: 'https://tver.jp/episodes/test', origin: 'https://tver.jp',
    },
    history: { pushState() {}, replaceState() {} },
    Date: class extends Date { static now() { return clock; } },
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
    get video() { return video; }, messages, window, stored, submitButtons,
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
  const form = {
    addEventListener() {}, querySelector: () => null, id: 'questionnaire-test',
  };
  const dialog = {
    querySelector: selector => selector.includes('questionnaire-') ? form : null,
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

test('saved questionnaire answers are filled and submitted before player controls', () => {
  const values = new Map();
  const inputs = Object.fromEntries(['birthYear', 'birthMonth', 'postCode']
    .map(name => [name, {
      get value() { return this._value || ''; },
      dispatchEvent: event => values.set(name, event.type),
    }]));
  let selectedGender = '';
  const gender = {
    getAttribute: name => name === 'value' ? '9' : name === 'aria-checked'
      ? String(selectedGender === '9') : null,
    click: () => { selectedGender = '9'; },
  };
  const form = {
    id: 'questionnaire-test', addEventListener() {},
    querySelector: selector => selector.includes('birthYear') ? inputs.birthYear
      : selector.includes('birthMonth') ? inputs.birthMonth
      : selector.includes('postCode') ? inputs.postCode
      : selector.includes('aria-checked') && selectedGender ? gender : null,
    querySelectorAll: () => [gender],
  };
  const dialog = {
    querySelector: () => form, getAttribute: () => null,
    textContent: 'アンケート',
  };
  const scene = playerScenario(1800, [], [], [dialog]);
  scene.stored.set('homepanel:tver:questionnaire:v1', JSON.stringify({
    year: '2000', month: '4', postCode: '1050004', genderCode: '9',
  }));
  scene.submitButtons.push({
    getAttribute: name => name === 'form' ? form.id : null,
    disabled: false,
    getBoundingClientRect: () => ({ left: 100, top: 200, width: 100, height: 40 }),
  });
  assert.equal(scene.run(), 'recovery');
  assert.equal(inputs.birthYear.value, '2000');
  assert.equal(inputs.birthMonth.value, '4');
  assert.equal(inputs.postCode.value, '1050004');
  assert.equal(selectedGender, '9');
  scene.advance(400);
  assert.deepEqual(Array.from(scene.run()), [150, 220]);
  scene.removeDialog(dialog);
  scene.run();
  assert.equal(scene.messages.includes('homepanel:tver-fullscreen-key'), true);
});

test('a manually submitted questionnaire supplies future automatic answers', () => {
  let onSubmit;
  const fields = { birthYear: '2000', birthMonth: '4', postCode: '1050004' };
  const form = {
    id: 'questionnaire-test',
    addEventListener: (name, callback) => { if (name === 'submit') onSubmit = callback; },
    querySelector: selector => selector.includes('aria-checked')
      ? { getAttribute: () => '9' }
      : Object.entries(fields).find(([name]) => selector.includes(name))
        ? { value: Object.entries(fields).find(([name]) => selector.includes(name))[1] }
        : null,
  };
  const scene = playerScenario(1800, [], [], [{
    querySelector: () => form, getAttribute: () => null, textContent: 'アンケート',
  }]);
  scene.run();
  onSubmit();
  assert.deepEqual(JSON.parse(scene.stored.get('homepanel:tver:questionnaire:v1')), {
    year: '2000', month: '4', postCode: '1050004', genderCode: '9',
  });
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
