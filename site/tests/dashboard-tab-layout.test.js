import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const theme = readFileSync(new URL('../public/monochrome.css', import.meta.url), 'utf8');
const sharedTabs = readFileSync(new URL('../public/pages-tabs-layout.css', import.meta.url), 'utf8');
const buildScript = readFileSync(new URL('../scripts/build-public-assets.mjs', import.meta.url), 'utf8');

test('dashboard tabs use the shared seven-column cap', () => {
  assert.match(
    sharedTabs,
    /#modeTabs\.mode-tabs\.dashboard-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(7, minmax\(0, 1fr\)\)\s*!important/s,
  );
  assert.ok(
    buildScript.indexOf("'pages-layout.css'") < buildScript.indexOf("'pages-tabs-layout.css'"),
    'shared tab cap must be bundled after the base layout',
  );
});

test('responsive tab column ownership is not duplicated in the monochrome theme', () => {
  assert.doesNotMatch(
    theme,
    /@media \(max-width: (?:760|430)px\)[\s\S]*?\.mode-tabs\.dashboard-tabs\s*\{[^}]*grid-template-columns/,
  );
});
