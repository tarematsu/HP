import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layout = readFileSync(new URL('../public/pages-layout.css', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../public/mobile-layout-refinements.css', import.meta.url), 'utf8');
const build = readFileSync(new URL('../scripts/build-public-assets.mjs', import.meta.url), 'utf8');

test('Buddies navigation stays on one horizontally scrollable row at every width', () => {
  assert.match(layout, /#modeTabs\.mode-tabs\.dashboard-tabs\s*\{[^}]*display: flex;[^}]*overflow-x: auto/s);
  assert.match(layout, /#modeTabs[^}]*> button\s*\{[^}]*white-space: nowrap/s);
  assert.match(mobile, /@media \(max-width: 760px\)/);
  assert.match(mobile, /#modeTabs\.mode-tabs\.dashboard-tabs\s*\{[^}]*display: flex;[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto;[^}]*overflow-y: hidden;/s);
  assert.match(mobile, /#modeTabs\.mode-tabs\.dashboard-tabs > button\s*\{[^}]*flex: 0 0 auto;[^}]*width: auto;[^}]*min-height: 44px;[^}]*white-space: nowrap;/s);
  assert.doesNotMatch(mobile, /#modeTabs\.mode-tabs\.dashboard-tabs\s*\{[^}]*grid-template-rows:/s);
  assert.doesNotMatch(build, /pages-tabs-layout\.css/);
});
