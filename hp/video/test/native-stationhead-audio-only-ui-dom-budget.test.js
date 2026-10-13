import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(
  new URL('../../native/src/sh_polling_policy.h', import.meta.url), 'utf8');
const script = source.match(
  /inline std::wstring StationheadAudioOnlyUiScript\(\) \{[\s\S]*?LR"JS\(([\s\S]*?)\)JS"/)?.[1];
assert.ok(script, 'the injected Stationhead room suppression script must be present');

function launchRoom({ text = 'Chat messages', hasCheapLabel = true } = {}) {
  const observers = [];
  const pending = [];
  let innerTextReads = 0;
  let hiddenWrites = 0;
  class Element {
    constructor() {
      this.isConnected = true;
      this.tagName = 'BUTTON';
      this.attrs = new Map();
    }
    getAttribute(key) { return this.attrs.get(key) ?? null; }
    setAttribute(key, value) {
      if (key === 'data-homepanel-audio-only-hidden') hiddenWrites++;
      this.attrs.set(key, value);
    }
    matches(selector) { return selector.includes('button'); }
    querySelectorAll() { return []; }
    querySelector() { return null; }
    closest() { return null; }
  }
  const element = new Element();
  element.textContent = hasCheapLabel ? text : '';
  Object.defineProperty(element, 'innerText', {
    get() { innerTextReads++; return text; },
  });
  const html = new Element();
  html.tagName = 'HTML';
  const document = {
    documentElement: html,
    body: new Element(),
    head: { appendChild() {} },
    visibilityState: 'visible',
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    querySelectorAll: selector => selector.includes('button') ? [element] : [],
    addEventListener() {},
  };
  class MutationObserver {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() {}
  }
  const window = {
    setTimeout: callback => { pending.push(callback); return pending.length; },
    clearTimeout() {},
  };
  runInNewContext(script, {
    window, document, location: { hostname: 'stationhead.com' },
    Element, MutationObserver,
  });
  return {
    element, observers, window,
    reads: () => innerTextReads,
    writes: () => hiddenWrites,
    nextMutation: () => {
      for (const observer of observers)
        observer.callback([{ type: 'attributes', target: element }]);
      while (pending.length) pending.shift()();
    },
  };
}

test('Stationhead room suppression uses textContent without a synchronous innerText layout read', () => {
  const room = launchRoom();
  assert.equal(room.writes(), 1, 'chat control is hidden');
  assert.equal(room.reads(), 0, 'cheap DOM content must avoid layout-forcing innerText');
  room.nextMutation();
  room.nextMutation();
  assert.equal(room.writes(), 1, 'repeated scans do not reapply the same DOM attribute');
  assert.equal(room.reads(), 0);
});

test('Stationhead room suppression preserves an innerText fallback for missing textContent', () => {
  const room = launchRoom({ hasCheapLabel: false });
  assert.equal(room.writes(), 1, 'CSS-backed/custom labels must remain hideable');
  assert.ok(room.reads() > 0, 'fallback remains for unavailable cheap text');
});

test('Stationhead audio-only suppression does not hide playback/login controls', () => {
  const room = launchRoom({ text: 'Connect Spotify' });
  assert.equal(room.writes(), 0);
  assert.equal(room.reads(), 0);
});

test('Stationhead room suppression retains bounded mutations and hidden-page suspension', () => {
  assert.match(script, /if \(target\.getAttribute\(hiddenAttribute\) !== 'true'\)/);
  assert.match(script, /if \(pending\.size >= 24\)/);
  assert.match(script, /if \(pageHidden\(\)\) \{\s*rescanOnVisible = true;/);
  assert.match(script, /attributeFilter: \['id', 'data-testid', 'aria-label', 'role', 'href'\]/);
});
