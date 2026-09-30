import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layout = readFileSync(new URL('../public/pages-layout.css', import.meta.url), 'utf8');
const build = readFileSync(new URL('../scripts/build-public-assets.mjs', import.meta.url), 'utf8');

test('navigation keeps readable labels in one scrollable row at every width', () => {
  assert.match(layout, /#modeTabs\.mode-tabs\.dashboard-tabs\s*\{[^}]*display: flex;[^}]*overflow-x: auto/s);
  assert.match(layout, /#modeTabs[^}]*> button\s*\{[^}]*white-space: nowrap/s);
  assert.match(layout, /@media \(max-width: 760px\)[\s\S]*#modeTabs[^}]*min-height: 44px;[\s\S]*font-size: 12px/);
  assert.doesNotMatch(build, /pages-tabs-layout\.css/);
});
