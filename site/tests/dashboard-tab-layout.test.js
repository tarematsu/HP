import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const navigation = readFileSync(new URL('../public/dashboard-navigation.css', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../public/pages-layout.css', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../public/mobile-layout-refinements.css', import.meta.url), 'utf8');
const registry = readFileSync(new URL('../public/dashboard-tab-registry.js', import.meta.url), 'utf8');
const stationhead = readFileSync(new URL('../public/stationhead-channel-tabs.js', import.meta.url), 'utf8');
const stationheadModel = readFileSync(new URL('../public/stationhead-channel-model.js', import.meta.url), 'utf8');

test('all Stationhead channel tabs share one five-column layout source', () => {
  assert.match(registry, /STATIONHEAD_CHANNEL_TABS/);
  assert.match(registry, /STATIONHEAD_CHANNEL_TABS\.map/);
  assert.match(registry, /classList\.add\('stationhead-subtabs'\)/);
  assert.match(stationheadModel, /export const STATIONHEAD_CHANNEL_TABS = Object\.freeze\(\[/);
  for (const value of ['current', 'history', 'played-tracks', 'likes', 'broadcasts']) {
    assert.match(stationheadModel, new RegExp(`value: '${value}'`));
  }
  assert.match(stationhead, /STATIONHEAD_CHANNEL_TABS\.map/);
  assert.match(navigation, /\.stationhead-subtabs\s*\{[^}]*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/s);
  assert.match(navigation, /\.stationhead-subtabs > button\s*\{[^}]*min-height: 44px/s);
  assert.doesNotMatch(layout + mobile, /#modeTabs\.mode-tabs\.dashboard-tabs/);
});

test('paused Stationhead sections are profile-driven and remain ready to re-enable', () => {
  assert.match(stationhead, /ohisama:[\s\S]*enabled: \['current', 'history', 'played-tracks', 'likes'\][\s\S]*paused: \['broadcasts'\]/);
  assert.match(stationhead, /nogizaka:[\s\S]*enabled: \['broadcasts'\][\s\S]*paused: \['current', 'history', 'played-tracks', 'likes'\]/);
  assert.match(stationhead, /pausedTitle = '一時停止中'/);
  assert.match(stationhead, /disabled: !enabledSet\.has\(value\)/);
  assert.match(navigation, /\.stationhead-subtabs > button:disabled[\s\S]*text-decoration: line-through/);
});
