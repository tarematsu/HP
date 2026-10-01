import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layout = readFileSync(new URL('../public/pages-layout.css', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../public/mobile-layout-refinements.css', import.meta.url), 'utf8');
const build = readFileSync(new URL('../scripts/build-public-assets.mjs', import.meta.url), 'utf8');

test('navigation is one row on larger screens and exactly two rows on mobile', () => {
  assert.match(layout, /#modeTabs\.mode-tabs\.dashboard-tabs\s*\{[^}]*display: flex;[^}]*overflow-x: auto/s);
  assert.match(layout, /#modeTabs[^}]*> button\s*\{[^}]*white-space: nowrap/s);
  assert.match(mobile, /@media \(max-width: 760px\)/);
  assert.match(mobile, /#modeTabs\.mode-tabs\.dashboard-tabs\s*\{[^}]*display: grid;[^}]*grid-template-columns: repeat\(7, max-content\);[^}]*grid-template-rows: repeat\(2, minmax\(44px, auto\)\);[^}]*overflow-x: auto;[^}]*overflow-y: hidden;/s);
  assert.match(mobile, /#modeTabs\.mode-tabs\.dashboard-tabs > button\s*\{[^}]*min-height: 44px;[^}]*white-space: nowrap;/s);
  assert.doesNotMatch(build, /pages-tabs-layout\.css/);
});
