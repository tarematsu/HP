import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8')
  .replace(/^import .*;$/gm, '')
  .replace(/\bimport\(/g, 'loadTestModule(');
const viewIds = ['currentView', 'historyView', 'hinataView', 'followersView', 'spotifyView', 'appleMusicView', 'amazonMusicView', 'firstWeekView', 'playedTracksView', 'nogizakaListeningPartyView', 'likesView'];
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness(hash = '', load = async () => ({ loadStationheadChannelView() {} })) {
  const nodes = new Map(viewIds.map(id => [id, { id, hidden: id !== 'currentView' }]));
  const buttons = ['current', 'hinata', 'followers', 'spotify', 'apple-music'].map(mode => {
    const classes = new Set();
    const attributes = new Map();
    return {
      dataset: { view: mode },
      classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); }, contains: name => classes.has(name) },
      setAttribute(name, value) { attributes.set(name, value); },
      removeAttribute(name) { attributes.delete(name); },
      getAttribute: name => attributes.get(name),
      closest() { return this; },
    };
  });
  const tabListeners = new Map();
  const windowListeners = new Map();
  const tabs = {
    contains: button => buttons.includes(button),
    querySelectorAll: () => buttons,
    addEventListener(name, callback) { tabListeners.set(name, callback); },
  };
  nodes.set('modeTabs', tabs);
  const location = { hash, pathname: '/', search: '', origin: 'https://pages.test', href: `https://pages.test/${hash}` };
  const updateLocation = (_state, _title, url) => {
    const next = new URL(url, location.origin);
    location.hash = next.hash;
    location.href = next.href;
  };
  const document = {
    getElementById: id => nodes.get(id),
    querySelector: () => null,
    createElement() {
      const listeners = new Map();
      return {
        dataset: {},
        addEventListener(name, callback) { listeners.set(name, callback); },
        dispatchLoad() { listeners.get('load')?.(); },
      };
    },
    head: { append(node) { queueMicrotask(() => node.dispatchLoad?.()); } },
    documentElement: { classList: { remove() {} } },
  };
  class TestHashChangeEvent extends Event {
    constructor(type, init = {}) { super(type); Object.assign(this, init); }
  }
  runInNewContext(source, {
    document,
    ensureDashboardSectionStyles: async () => {},
    location,
    history: { pushState: updateLocation, replaceState: updateLocation },
    window: { addEventListener(name, callback) { windowListeners.set(name, callback); }, dispatchEvent() {} },
    Event,
    HashChangeEvent: TestHashChangeEvent,
    console,
    loadTestModule: load,
    queueMicrotask,
  });
  return {
    visible: () => [...nodes.values()].filter(node => node.id && !node.hidden).map(node => node.id),
    button: mode => buttons.find(button => button.dataset.view === mode),
    click(mode) { tabListeners.get('click')({ target: this.button(mode), preventDefault() {} }); },
    back(mode) {
      location.hash = mode ? `#${mode}` : '';
      location.href = `https://pages.test/${location.hash}`;
      windowListeners.get('popstate')();
    },
    location,
  };
}

test('direct Hinata and followers links activate exactly one view in the common router', async () => {
  for (const [mode, id] of [['hinata', 'hinataView'], ['followers', 'followersView']]) {
    const page = harness(`#${mode}`);
    await flush();
    assert.deepEqual(page.visible(), [id]);
    assert.equal(page.button(mode).getAttribute('aria-current'), 'page');
  }
});

test('switching between lazy tabs and browser Back keeps one visible view and one selected tab', async () => {
  const page = harness();
  for (const [mode, id] of [['hinata', 'hinataView'], ['followers', 'followersView'], ['spotify', 'spotifyView'], ['current', 'currentView']]) {
    page.click(mode);
    await flush();
    assert.deepEqual(page.visible(), [id]);
    assert.equal(page.button(mode).getAttribute('aria-current'), 'page');
    assert.equal(page.location.hash, mode === 'current' ? '' : `#${mode}`);
  }
  page.back('followers');
  await flush();
  assert.deepEqual(page.visible(), ['followersView']);
  assert.equal(page.button('followers').getAttribute('aria-current'), 'page');
  assert.equal(page.button('current').getAttribute('aria-current'), undefined);
});

test('a late lazy import cannot reopen a tab after the user leaves it', async () => {
  let finish;
  let loaded = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const page = harness('', path => path.includes('/hinata.js') ? pending : Promise.resolve({ loadStationheadChannelView() {} }));
  page.click('hinata');
  page.click('current');
  finish({ loadHinataView() { loaded++; } });
  await flush();
  assert.deepEqual(page.visible(), ['currentView']);
  assert.equal(loaded, 0);
});
