import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = name => readFileSync(
  new URL('../../native/src/' + name, import.meta.url), 'utf8');
const fragment = name => source(name).match(/LR"JS\(([\s\S]*?)\)JS"/)?.[1];

function runPrompt(label, { credential = false, extraLogin = false, path = '/sakuramankai' } = {}) {
  const pattern = source('sh_recoverable_action_policy.h')
    .match(/kStationheadRecoverableActionPattern = LR"JS\((.*?)\)JS"/s)?.[1];
  assert.ok(pattern);
  const script = (
    fragment('sh_runtime_interaction_script.h') +
    fragment('sh_runtime_onboarding_script.h') +
    '\nreturn { publishAuth, blockingLogin }; })()'
  ).replace('{{RECOVERABLE_ACTION_PATTERN}}', pattern)
    .replace('{{GLOBAL}}', '__test')
    .replace('{{PREFIX}}', 'stationhead');

  class Element {}
  const rect = { left: 0, top: 0, right: 200, bottom: 70, width: 200, height: 70 };
  const modal = new Element();
  const link = new Element();
  const login = new Element();
  const input = new Element();
  for (const element of [modal, link, login, input]) {
    element.isConnected = true;
    element.getBoundingClientRect = () => rect;
    element.getAttribute = name => name === 'href' && element === link
      ? '/api/spotify/login?returnTo=%2Fsakuramankai' : null;
  }
  link.innerText = link.textContent = label;
  link.closest = () => modal;
  login.innerText = login.textContent = 'Log in';
  login.closest = () => modal;
  const messages = [];
  const document = {
    body: {},
    documentElement: { hasAttribute: () => false },
    querySelectorAll: selector => selector.includes('audio,video') ? []
      : selector.includes("input[type='password']") ? (credential ? [input] : [])
      : extraLogin ? [link, login] : [link],
  };
  const window = {
    top: null,
    setTimeout: () => 1,
    clearTimeout: () => {},
    chrome: { webview: { postMessage: value => messages.push(value) } },
  };
  window.top = window;
  const runtime = runInNewContext(script, {
    window, document, Element, location: {
      hostname: 'www.stationhead.com', pathname: path,
    },
    navigator: {}, innerWidth: 360, innerHeight: 960,
    getComputedStyle: () => ({
      display: 'block', visibility: 'visible', opacity: '1',
      pointerEvents: 'auto', content: 'none',
    }),
  });
  runtime.publishAuth();
  return messages;
}

test('OAuth login destination on Connect Spotify is signaled for trusted click', () => {
  assert.ok(runPrompt('Connect Spotify').includes('stationhead-start-visible'));
  assert.ok(runPrompt('Continue with Spotify').includes('stationhead-start-visible'));
  assert.ok(runPrompt('Connect Spotify', { extraLogin: true })
    .includes('stationhead-start-visible'));
});

test('visible Connect Spotify does not claim authentication on repeated probes', () => {
  const messages = runPrompt('Connect Spotify');
  assert.ok(messages.includes('stationhead-start-visible'));
  assert.ok(!messages.some(message =>
    message && typeof message === 'object' &&
    message.type === 'stationhead-auth-ready'));
});

test('login controls and credential inputs still block trusted click', () => {
  assert.ok(!runPrompt('Log in').includes('stationhead-start-visible'));
  assert.ok(!runPrompt('Connect Spotify', { credential: true })
    .includes('stationhead-start-visible'));
  assert.ok(!runPrompt('Connect Spotify', { path: '/auth' })
    .includes('stationhead-start-visible'));
});
