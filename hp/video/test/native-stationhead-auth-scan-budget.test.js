import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = name => readFileSync(
  new URL('../../native/src/' + name, import.meta.url), 'utf8');
const fragment = name => source(name).match(/LR"JS\(([\s\S]*?)\)JS"/)?.[1];

function authRuntime({ label = 'Profile', text = '', audioPlaying = false,
                       credential = false, route = '/sakuramankai' } = {}) {
  const pattern = source('sh_recoverable_action_policy.h')
    .match(/kStationheadRecoverableActionPattern = LR"JS\((.*?)\)JS"/s)?.[1];
  assert.ok(pattern);
  const script = (
    fragment('sh_runtime_interaction_script.h') +
    fragment('sh_runtime_onboarding_script.h') +
    '\nreturn { publishAuth, accountVisible, blockingLogin, playing }; })()'
  ).replace('{{RECOVERABLE_ACTION_PATTERN}}', pattern)
    .replace('{{GLOBAL}}', '__authBudget')
    .replace('{{PREFIX}}', 'stationhead');

  class Element {}
  const control = new Element();
  control.isConnected = true;
  control.innerText = text;
  control.textContent = '';
  control.getAttribute = key => key === 'aria-label' ? label : null;
  control.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 160, height: 40, right: 160, bottom: 40,
  });
  control.querySelector = () => null;
  control.closest = () => null;
  let controlQueries = 0;
  let credentialQueries = 0;
  const document = {
    body: {},
    documentElement: { hasAttribute: () => false },
    querySelectorAll: selector => {
      if (selector === 'audio,video') return [];
      if (selector.startsWith("input[type='password']")) {
        credentialQueries += 1;
        return credential ? [control] : [];
      }
      if (selector.includes('h1,h2,h3,')) return [control]; // onboarding
      controlQueries += 1;
      return [control];
    },
  };
  const timers = new Map();
  let nextTimer = 0;
  const messages = [];
  const window = {
    top: null, __homepanelAudioPlaying: audioPlaying,
    setTimeout: (fn, ms) => {
      const id = ++nextTimer;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    chrome: { webview: { postMessage: message => messages.push(message) } },
  };
  window.top = window;
  const runtime = runInNewContext(script, {
    window, document, Element, navigator: {},
    location: { hostname: 'stationhead.com', pathname: route },
    innerWidth: 360, innerHeight: 960,
    getComputedStyle: (_element, pseudo) => ({
      content: 'none',
      display: 'block', visibility: 'visible', opacity: '1',
      pointerEvents: 'auto',
    }),
  });
  return {
    runtime, window, messages, timers,
    counts: () => ({ controlQueries, credentialQueries }),
  };
}

test('normal auth event shares one control query between account and login detection', () => {
  const { runtime, counts } = authRuntime({ label: 'Settings' });
  runtime.publishAuth();
  assert.equal(counts().controlQueries, 1);
  assert.equal(counts().credentialQueries, 1);
});

test('login-required detection still works for a silent account', () => {
  const { runtime, messages, counts } = authRuntime({
    label: null, text: 'Log in', audioPlaying: false,
  });
  runtime.publishAuth();
  assert.equal(counts().controlQueries, 1);
  assert.ok(messages.includes('stationhead-login-required'));
});

test('auth completion re-queries the page rather than retaining stale controls', () => {
  const { runtime, messages, timers, counts } = authRuntime({
    label: 'Profile',
  });
  runtime.publishAuth();
  assert.equal(counts().controlQueries, 1);
  const callback = [...timers.values()].find(item => item.ms === 3000);
  assert.ok(callback, 'auth ready confirmation timer missing');
  callback.fn();
  assert.equal(counts().controlQueries, 2);
  assert.equal(messages.filter(message =>
    message?.type === 'stationhead-auth-ready').length, 1);
});

test('explicit recovery retains independent credential and login-route guards', () => {
  const withCredential = authRuntime({ credential: true });
  assert.equal(withCredential.runtime.blockingLogin(true, true), true);
  const onLoginRoute = authRuntime({ route: '/auth' });
  assert.equal(onLoginRoute.runtime.blockingLogin(true, true), true);
});

test('media element state check does not copy the queried NodeList to an Array', () => {
  const interaction = source('sh_runtime_interaction_script.h');
  const lifecycle = source('sh_runtime_lifecycle_script.h');
  assert.doesNotMatch(interaction, /Array\.from\(document\.querySelectorAll\('audio,video'\)\)/);
  assert.doesNotMatch(lifecycle, /Array\.from\(document\.querySelectorAll\('audio,video'\)\)/);
  assert.match(lifecycle, /progressCandidateMedia = media;\s*return media;/);
  assert.match(lifecycle, /progressCandidateMedia = null;\s*return null;/);
});
