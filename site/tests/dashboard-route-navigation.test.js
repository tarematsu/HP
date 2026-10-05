import * as navigation from '../public/dashboard-navigation-config.js';
import { syncRovingTabs } from '../public/dashboard-roving-tabs.js';
import { loadDashboardModuleOnce } from '../public/dashboard-view-loader.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;$/gm, '')
  .replace(/\bimport\(/g, 'loadTestModule(');
const viewIds = ['currentView', 'historyView', 'hinataView', 'followersView', 'spotifyView', 'appleMusicView', 'amazonMusicView', 'firstWeekView', 'playedTracksView', 'nogizakaListeningPartyView', 'likesView'];
const flush = () => new Promise(resolve => setImmediate(resolve));

let nextHarnessId = 0;
function harness(hash = '', load = async () => ({ loadStationheadChannelView() {} })) {
  const harnessId = ++nextHarnessId;
  const nodes = new Map(viewIds.map(id => [id, { id, hidden: id !== 'currentView' }]));
  function button() {
    const classes = new Set();
    const attributes = new Map();
    return {
      dataset: {},
      classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); }, contains: name => classes.has(name) },
      setAttribute(name, value) { attributes.set(name, value); },
      removeAttribute(name) { attributes.delete(name); },
      getAttribute: name => attributes.get(name),
      closest() { return this; },
      addEventListener() {},
    };
  }
  function container() {
    const node = button();
    node.children = [];
    node.listeners = new Map();
    node.append = child => node.children.push(child);
    node.replaceChildren = (...children) => { node.children = children.flatMap(child => child.children || [child]); };
    node.querySelectorAll = () => node.children;
    node.querySelector = () => node.children.find(child => child.classList.contains('active'));
    node.contains = child => node.children.includes(child);
    node.addEventListener = (name, callback) => node.listeners.set(name, callback);
    node.after = () => {};
    return node;
  }
  const windowListeners = new Map();
  const functions = container();
  const sections = container();
  const sources = container();
  for (const section of navigation.NAVIGATION) {
    const node = button(); node.dataset.section = section.id; sections.append(node);
  }
  nodes.set('functionTabs', functions);
  nodes.set('sectionTabs', sections);
  nodes.set('sourceTabs', sources);
  nodes.set('sourceSelect', { replaceChildren() {} });
  const location = { hash, pathname: '/', search: '', origin: 'https://pages.test', href: `https://pages.test/${hash}` };
  const updateLocation = (_state, _title, url) => {
    const next = new URL(url, location.origin);
    location.hash = next.hash;
    location.href = next.href;
  };
  const document = {
    createDocumentFragment: container,
    getElementById: id => nodes.get(id),
    querySelector: () => null,
    createElement: button,
    head: { append() {} },
    documentElement: { classList: { remove() {} } },
  };
  class TestHashChangeEvent extends Event {
    constructor(type, init = {}) { super(type); Object.assign(this, init); }
  }
  runInNewContext(source, {
    ...navigation,
    bindRovingTabs() {},
    syncRovingTabs,
    loadOnce: (key, importer) => loadDashboardModuleOnce(`${harnessId}:${key}`, importer),
    showRuntimeError(_config, error) { throw error; },
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
    selected: () => ({
      section: sections.querySelector()?.dataset.section,
      source: sources.querySelector()?.dataset.source,
      mode: functions.querySelector()?.dataset.mode,
    }),
    click(mode) {
      const { section, source } = navigation.navigationForMode(mode);
      const click = (node, target) => node.listeners.get('click')({ target });
      if (sections.querySelector()?.dataset.section !== section.id) {
        click(sections, sections.children.find(node => node.dataset.section === section.id));
      }
      if (sources.querySelector()?.dataset.source !== source.id) {
        click(sources, sources.children.find(node => node.dataset.source === source.id));
      }
      const target = functions.children.find(node => node.dataset.mode === mode);
      if (target) click(functions, target);
    },
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
    assert.equal(page.location.hash, `#${mode}`);
    const expected = navigation.navigationForMode(mode);
    assert.equal(page.selected().source, expected.source.id);
  }
});

test('switching between lazy tabs and browser Back keeps one visible view and one selected tab', async () => {
  const page = harness();
  for (const [mode, id] of [['hinata', 'hinataView'], ['followers', 'followersView'], ['spotify', 'spotifyView'], ['current', 'currentView']]) {
    page.click(mode);
    await flush();
    assert.deepEqual(page.visible(), [id]);
    assert.equal(page.location.hash, mode === 'current' ? '' : `#${mode}`);
    const expected = navigation.navigationForMode(mode);
    assert.equal(page.selected().source, expected.source.id);
    if (expected.source.functions.length > 1) assert.equal(page.selected().mode, mode);
  }
  page.back('followers');
  await flush();
  assert.deepEqual(page.visible(), ['followersView']);
  assert.equal(page.location.hash, '#followers');
  assert.equal(page.selected().mode, 'followers');
});

test('a late lazy import cannot reopen a tab after the user leaves it', async () => {
  let finish;
  let loaded = 0;
  let requested = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const page = harness('', path => { if (path.includes('/hinata.js')) { requested++; return pending; } return Promise.resolve({ loadStationheadChannelView() {} }); });
  page.click('hinata');
  await flush();
  assert.equal(requested, 1);
  page.click('current');
  finish({ loadHinataView() { loaded++; } });
  await flush();
  assert.deepEqual(page.visible(), ['currentView']);
  assert.equal(loaded, 0);
});

test('played tracks and likes select the shared Buddies panel without standalone imports', async () => {
  const selected = [];
  const imports = [];
  const page = harness('', async path => {
    imports.push(path);
    return {
      selectStationheadChannelSection(_view, panel) { selected.push(panel); },
      loadStationheadChannelView() {},
    };
  });
  await flush();
  for (const mode of ['played-tracks', 'likes']) {
    page.click(mode);
    await flush();
    assert.deepEqual(page.visible(), ['currentView']);
    assert.equal(page.selected().mode, mode);
    assert.equal(selected.at(-1), mode);
    assert.equal(page.location.hash, `#${mode}`);
  }
  assert.equal(imports.filter(path => path.includes('stationhead-channel.js')).length, 1);
  assert.ok(imports.every(path => !/played-tracks|history-likes/.test(path)));
});
