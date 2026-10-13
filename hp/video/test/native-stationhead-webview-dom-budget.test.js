import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = name => readFileSync(
  new URL('../../native/src/' + name, import.meta.url), 'utf8');
// Fragments can contain multiple adjacent C++ raw literals to stay within
// the MSVC C2026 limit. Join them before evaluating the page runtime.
const fragment = name => [...source(name).matchAll(/LR"JS\(([\s\S]*?)\)JS"/g)]
  .map(match => match[1]).join('');

function onboardingRuntime({ text = 'Some unrelated room content', pseudo = 'none', visible = true,
                             playbackOnly = false } = {}) {
  const policy = source('sh_recoverable_action_policy.h');
  const pattern = policy.match(/kStationheadRecoverableActionPattern = LR"JS\((.*?)\)JS"/s)?.[1];
  assert.ok(pattern);
  const script = (
    fragment('sh_runtime_interaction_script.h') +
    fragment('sh_runtime_onboarding_script.h') +
    '\nreturn { onboardingMatches, onboardingLabelMatches, publishRecoverableOnboarding, releasePlaybackOnlyForOnboarding, scanOnboardingCandidates }; })()'
  ).replace('{{RECOVERABLE_ACTION_PATTERN}}', pattern)
    .replace('{{GLOBAL}}', '__budget')
    .replace('{{PREFIX}}', 'stationhead');

  class Element {}
  const element = new Element();
  const candidates = [element];
  let rectReads = 0;
  let normalStyles = 0;
  let pseudoStyles = 0;
  let innerTextReads = 0;
  let roomSelectorScans = 0;
  const messages = [];
  const playbackAttribute = 'data-homepanel-stationhead-playback-only';
  let playbackHidden = playbackOnly;
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
    chrome: { webview: { postMessage: value => messages.push(value) } },
  };
  window.top = window;
  const runtime = runInNewContext(script, {
    window, Element,
    document: {
      body: {}, documentElement: {
        hasAttribute: key => key === playbackAttribute && playbackHidden,
        removeAttribute: key => { if (key === playbackAttribute) playbackHidden = false; },
      },
      querySelectorAll: selector => {
        if (selector.includes("h1,h2,h3,[role='heading'],div,span,p")) {
          roomSelectorScans += 1;
          return candidates;
        }
        return [];
      },
    },
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
    counts: () => ({ rectReads, normalStyles, pseudoStyles, innerTextReads, roomSelectorScans }),
    messages,
    playbackHidden: () => playbackHidden,
    candidates,
    addCandidate: label => {
      const candidate = new Element();
      candidate.isConnected = true;
      candidate.textContent = candidate.innerText = label;
      candidate.getAttribute = () => null;
      candidate.getBoundingClientRect = element.getBoundingClientRect;
      candidates.push(candidate);
      return candidate;
    },
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

test('recoverable action match avoids allocating arrays or eagerly reading later attributes', () => {
  const { element, runtime, counts, candidates } = onboardingRuntime();
  const readAttributes = [];
  element.getAttribute = key => {
    readAttributes.push(key);
    return key === 'aria-label' ? 'Keep Streaming' : null;
  };
  assert.equal(runtime.onboardingLabelMatches(element, /^keep streaming$/i), true);
  assert.deepEqual(readAttributes, ['aria-label']);
  assert.equal(runtime.scanOnboardingCandidates(candidates), 1);
  assert.deepEqual(readAttributes, ['aria-label', 'aria-label', 'aria-hidden'],
    'the visibility guard still reads aria-hidden after identifying the action');
  assert.equal(counts().innerTextReads, 0);
  assert.equal(counts().pseudoStyles, 0);
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
  const target = { matches: selector => selector === 'audio,video' };
  listeners.get('playing')({ type: 'playing', target });
  listeners.get('playing')({ type: 'playing', target });
  assert.equal(adds, 1);
  listeners.get('pause')({ type: 'pause', target });
  listeners.get('pause')({ type: 'pause', target });
  assert.equal(removals, 1);
});

test('one Stationhead recovery probe shares a single room DOM query across its checks', () => {
  const { runtime, counts } = onboardingRuntime();
  assert.equal(runtime.publishRecoverableOnboarding(), false);
  assert.equal(counts().roomSelectorScans, 1);
  assert.equal(runtime.publishRecoverableOnboarding(), false);
  assert.equal(counts().roomSelectorScans, 2);
});

test('Keep Streaming still wins before recoverable onboarding with one room query', () => {
  const { runtime, counts, messages } = onboardingRuntime({ text: 'Keep Streaming' });
  assert.equal(runtime.publishRecoverableOnboarding(), true);
  assert.equal(counts().roomSelectorScans, 1);
  assert.deepEqual(messages, ['stationhead-start-visible']);
});

test('Connect Spotify still triggers native click notification using one room query', () => {
  const { runtime, counts, messages } = onboardingRuntime({ text: 'Connect Spotify' });
  assert.equal(runtime.publishRecoverableOnboarding(), true);
  assert.equal(counts().roomSelectorScans, 1);
  assert.deepEqual(messages, ['stationhead-start-visible']);
});

test('hidden Stationhead room checks three recovery patterns with only two pseudo-style reads', () => {
  const { element, runtime, counts, playbackHidden } = onboardingRuntime({
    playbackOnly: true,
  });
  assert.equal(runtime.releasePlaybackOnlyForOnboarding([element]), false);
  assert.equal(playbackHidden(), true);
  // Previously each of three patterns fetched ::before and ::after separately.
  assert.equal(counts().pseudoStyles, 2);
  assert.equal(counts().innerTextReads, 1);
});

test('hidden room immediately reveals Connect Spotify and Keep Streaming controls', () => {
  for (const text of ['Connect Spotify', 'Keep Streaming', 'Reconnect Music']) {
    const { element, runtime, playbackHidden, counts } = onboardingRuntime({
      text, playbackOnly: true,
    });
    assert.equal(runtime.releasePlaybackOnlyForOnboarding([element]), true, text);
    assert.equal(playbackHidden(), false, text);
    assert.equal(counts().pseudoStyles, 0);
    assert.equal(counts().innerTextReads, 0);
  }
});

test('CSS pseudo-only reconnect prompt reveals hidden UI in one style lookup', () => {
  const { element, runtime, playbackHidden, counts } = onboardingRuntime({
    text: '', pseudo: '"Reconnect Music"', playbackOnly: true,
  });
  assert.equal(runtime.releasePlaybackOnlyForOnboarding([element]), true);
  assert.equal(playbackHidden(), false);
  assert.equal(counts().pseudoStyles, 1);
});


test('fused recovery scanner reads an unrelated label and its pseudo-styles only once', () => {
  const { runtime, candidates, counts } = onboardingRuntime();
  assert.equal(runtime.scanOnboardingCandidates(candidates), 0);
  assert.equal(counts().innerTextReads, 1);
  assert.equal(counts().pseudoStyles, 2);
  assert.equal(counts().rectReads, 0);
});

test('Keep Streaming outranks an earlier Connect Spotify candidate in a single pass', () => {
  const { runtime, candidates, addCandidate, messages, counts } = onboardingRuntime({
    text: 'Connect Spotify',
  });
  addCandidate('Keep Streaming');
  assert.equal(runtime.scanOnboardingCandidates(candidates), 1);
  assert.equal(runtime.publishRecoverableOnboarding(), true);
  assert.equal(counts().roomSelectorScans, 1);
  assert.deepEqual(messages, ['stationhead-start-visible']);
});

test('pseudo-element-only Keep Streaming retains priority and visible guard', () => {
  const { runtime, candidates, counts } = onboardingRuntime({
    text: '', pseudo: '"Keep Streaming"',
  });
  assert.equal(runtime.scanOnboardingCandidates(candidates), 1);
  assert.ok(counts().pseudoStyles >= 1);
  const invisible = onboardingRuntime({
    text: '', pseudo: '"Keep Streaming"', visible: false,
  });
  assert.equal(invisible.runtime.scanOnboardingCandidates(invisible.candidates), 0);
});

test('hidden Connect Spotify UI is restored before the fused scanner checks geometry', () => {
  const { runtime, playbackHidden, counts } = onboardingRuntime({
    text: 'Connect Spotify', playbackOnly: true,
  });
  assert.equal(runtime.publishRecoverableOnboarding(), true);
  assert.equal(playbackHidden(), false);
  assert.equal(counts().roomSelectorScans, 1);
});
