import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = name => readFileSync(
  new URL('../../native/src/' + name, import.meta.url), 'utf8');
const fragment = name => source(name).match(/LR"JS\(([\s\S]*?)\)JS"/)?.[1];

function onboardingRuntime({ text = 'Some unrelated room content', pseudo = 'none', visible = true } = {}) {
  const policy = source('sh_recoverable_action_policy.h');
  const pattern = policy.match(/kStationheadRecoverableActionPattern = LR"JS\((.*?)\)JS"/s)?.[1];
  assert.ok(pattern);
  const script = (
    fragment('sh_runtime_interaction_script.h') +
    fragment('sh_runtime_onboarding_script.h') +
    '\nreturn { onboardingMatches, onboardingLabelMatches }; })()'
  ).replace('{{RECOVERABLE_ACTION_PATTERN}}', pattern)
    .replace('{{GLOBAL}}', '__budget')
    .replace('{{PREFIX}}', 'stationhead');

  class Element {}
  const element = new Element();
  let rectReads = 0;
  let normalStyles = 0;
  let pseudoStyles = 0;
  let innerTextReads = 0;
  element.isConnected = true;
  element.textContent = text;
  Object.defineProperty(element, 'innerText', {
    get() { innerTextReads += 1; return text; },
  });
  element.getAttribute = () => null;
  element.getBoundingClientRect = () => {
    rectReads += 1;
    return { width: 120, height: 32 };
  };

  const window = {
    top: null, setTimeout: () => 1, clearTimeout: () => {},
    chrome: { webview: { postMessage: () => {} } },
  };
  window.top = window;
  const runtime = runInNewContext(script, {
    window, Element,
    document: { body: {}, documentElement: { hasAttribute: () => false }, querySelectorAll: () => [] },
    location: { hostname: 'stationhead.com', pathname: '/sakuramankai' },
    navigator: {}, innerWidth: 360, innerHeight: 960,
    getComputedStyle: (_, selector) => {
      if (selector) pseudoStyles += 1;
      else normalStyles += 1;
      return { content: selector === '::before' ? pseudo : 'none',
        display: visible ? 'block' : 'none', visibility: 'visible', opacity: 1 };
    },
  });
  return {
    element, runtime,
    counts: () => ({ rectReads, normalStyles, pseudoStyles, innerTextReads }),
  };
}

test('unrelated Stationhead DOM does not incur expensive geometry checks', () => {
  const { element, runtime, counts } = onboardingRuntime();
  assert.equal(runtime.onboardingMatches(element, /^connect spotify$/i), false);
  assert.equal(counts().rectReads, 0);
  assert.equal(counts().normalStyles, 0);
});

test('plain-text action matches without forced innerText or pseudo-style reads', () => {
  const { element, runtime, counts } = onboardingRuntime({ text: 'Connect Spotify' });
  assert.equal(runtime.onboardingMatches(element, /^connect spotify$/i), true);
  assert.equal(counts().innerTextReads, 0);
  assert.equal(counts().pseudoStyles, 0);
  assert.equal(counts().rectReads, 1);
  assert.equal(counts().normalStyles, 1);
});

test('CSS pseudo-element-only recovery actions remain detectable', () => {
  const { element, runtime, counts } = onboardingRuntime({
    text: '', pseudo: '"Connect Spotify"',
  });
  assert.equal(runtime.onboardingMatches(element, /^connect spotify$/i), true);
  assert.equal(counts().pseudoStyles, 1);
  assert.equal(counts().rectReads, 1);
});

test('non-visible Connect Spotify remains ineligible for trusted interaction', () => {
  const { element, runtime } = onboardingRuntime({
    text: 'Connect Spotify', visible: false,
  });
  assert.equal(runtime.onboardingMatches(element, /^connect spotify$/i), false);
});

test('playback-only room CSS attribute is updated only on state transitions', () => {
  const script = fragment('sh_room_ui_reduction_policy.h');
  assert.ok(script);
  const listeners = new Map();
  const attrs = new Map();
  let adds = 0;
  let removals = 0;
  const html = {
    hasAttribute(name) { return attrs.has(name); },
    setAttribute(name, value) { adds += 1; attrs.set(name, value); },
    removeAttribute(name) { removals += 1; attrs.delete(name); },
  };
  const document = {
    documentElement: html,
    head: { appendChild: () => {} },
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    addEventListener(type, callback) { listeners.set(type, callback); },
  };
  const window = {
    addEventListener: () => {},
    __homepanelStationheadAudioOnlyUi: false,
  };
  runInNewContext(script, {
    document, window,
    location: { hostname: 'stationhead.com', pathname: '/sakuramankai' },
  });
  const event = { target: { matches: selector => selector === 'audio,video' } };
  listeners.get('playing')(event);
  listeners.get('playing')(event);
  assert.equal(adds, 1);
  listeners.get('pause')(event);
  listeners.get('pause')(event);
  assert.equal(removals, 1);
});
