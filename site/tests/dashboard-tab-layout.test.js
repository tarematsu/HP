import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const navigation = readFileSync(new URL('../public/dashboard-navigation.css', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../public/pages-layout.css', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../public/mobile-layout-refinements.css', import.meta.url), 'utf8');
const registry = readFileSync(new URL('../public/dashboard-tab-registry.js', import.meta.url), 'utf8');
const stationheadShell = readFileSync(new URL('../public/stationhead-channel-shell.js', import.meta.url), 'utf8');
const stationheadRuntime = readFileSync(new URL('../public/stationhead-channel.js', import.meta.url), 'utf8');
const stationheadReadModel = readFileSync(new URL('../public/stationhead-channel-read-model.js', import.meta.url), 'utf8');
const stationheadModel = readFileSync(new URL('../public/stationhead-channel-model.js', import.meta.url), 'utf8');

test('all Stationhead channel tabs share one five-column layout source', () => {
  assert.match(registry, /tabs\.replaceChildren\(\)/);
  assert.doesNotMatch(registry, /STATIONHEAD_CHANNEL_TABS|createElement\('button'\)/);
  assert.match(stationheadShell, /STATIONHEAD_CHANNEL_TABS\.map/);
  assert.match(stationheadShell, /className: 'stationhead-subtabs'/);
  assert.match(stationheadModel, /export const STATIONHEAD_CHANNEL_TABS = Object\.freeze\(\[/);
  for (const value of ['current', 'history', 'played-tracks', 'likes', 'broadcasts']) {
    assert.match(stationheadModel, new RegExp(`value: '${value}'`));
  }
  assert.match(navigation, /\.stationhead-subtabs\s*\{[^}]*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/s);
  assert.match(navigation, /\.stationhead-subtabs > button\s*\{[^}]*min-height: 44px/s);
  assert.doesNotMatch(layout + mobile, /#modeTabs\.mode-tabs\.dashboard-tabs/);
});

test('paused Stationhead sections are read-model-driven and remain ready to re-enable', () => {
  assert.match(stationheadReadModel, /function ohisamaModel\(\)[\s\S]*capabilities: \['current', 'history', 'played-tracks', 'likes'\]/);
  assert.match(stationheadReadModel, /function nogizakaModel\(\)[\s\S]*capabilities: \['broadcasts'\]/);
  assert.match(stationheadRuntime, /const capabilities = new Set\(model\.capabilities\)/);
  assert.match(stationheadRuntime, /button\.disabled = !enabled/);
  assert.match(stationheadRuntime, /button\.setAttribute\('aria-disabled', String\(!enabled\)\)/);
  assert.match(navigation, /\.stationhead-subtabs > button:disabled[\s\S]*text-decoration: line-through/);
});
