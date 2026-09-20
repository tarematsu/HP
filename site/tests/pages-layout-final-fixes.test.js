import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/pages-layout-final-fixes.css', import.meta.url), 'utf8');

test('final screenshot-audit overrides load after cross-view unification', () => {
  assert.match(header, /pages-layout-final-fixes\.css\?v=20260921\.1/);
  assert.ok(
    header.indexOf('layoutUnificationHref') < header.indexOf('layoutFinalFixesHref'),
    'final layout fixes must load last',
  );
});

test('legacy span-two mobile tab placement is cancelled', () => {
  assert.match(css, /#modeTabs\.mode-tabs\.dashboard-tabs > button,/);
  assert.match(css, /#modeTabs\.mode-tabs\.dashboard-tabs > button:last-child/);
  assert.match(css, /grid-column:\s*auto !important/);
});
