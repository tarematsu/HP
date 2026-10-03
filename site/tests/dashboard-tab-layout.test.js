import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const navigation = readFileSync(new URL('../public/dashboard-navigation.css', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../public/pages-layout.css', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../public/mobile-layout-refinements.css', import.meta.url), 'utf8');
const registry = readFileSync(new URL('../public/dashboard-tab-registry.js', import.meta.url), 'utf8');

test('all Stationhead channel tabs share five columns and touch target height', () => {
  assert.match(registry, /classList\.add\('stationhead-subtabs'\)/);
  assert.match(navigation, /#modeTabs\.mode-tabs\.dashboard-tabs,\s*\.stationhead-subtabs\s*\{[^}]*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/s);
  assert.match(navigation, /\.stationhead-subtabs > button\s*\{[^}]*min-height: 44px/s);
  assert.doesNotMatch(layout + mobile, /#modeTabs\.mode-tabs\.dashboard-tabs/);
});
