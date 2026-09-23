import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/pages-layout-final-fixes.css', import.meta.url), 'utf8');

test('final screenshot-audit overrides load after cross-view unification', () => {
  assert.match(header, /pages-layout-final-fixes\.css\?v=20260924\.1/);
  assert.ok(
    header.indexOf('layoutUnificationHref') < header.indexOf('layoutFinalFixesHref'),
    'final layout fixes must load last',
  );
});

test('dashboard tabs use two rows of five on phones and one row on wider screens', () => {
  assert.match(css, /#modeTabs\.mode-tabs\.dashboard-tabs\s*\{[\s\S]*grid-template-columns:\s*repeat\(9, minmax\(0, 1fr\)\) !important/);
  assert.match(css, /grid-template-rows:\s*34px !important/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*#modeTabs\.mode-tabs\.dashboard-tabs\s*\{[\s\S]*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\) !important/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*grid-template-rows:\s*repeat\(2, 32px\) !important/);
});

test('legacy span-two mobile tab placement is cancelled', () => {
  assert.match(css, /#modeTabs\.mode-tabs\.dashboard-tabs > button,/);
  assert.match(css, /#modeTabs\.mode-tabs\.dashboard-tabs > button:last-child/);
  assert.match(css, /grid-column:\s*auto !important/);
});

test('all views share one section rhythm and heading scale', () => {
  assert.match(css, /#historyView > \.summary-cards,[\s\S]*#likesView > \.summary-cards/);
  assert.match(css, /\.section-head\s*\{[\s\S]*min-height:\s*34px !important/);
  assert.match(css, /\.section-head h2\s*\{[\s\S]*font-size:\s*1rem !important/);
  assert.match(css, /\.metric > span,[\s\S]*\.summary-cards span,[\s\S]*\.host,[\s\S]*\.pill/);
  assert.match(css, /\.summary-cards article\s*\{[\s\S]*min-height:\s*68px !important/);
});

test('ranking update button stays compact on desktop and mobile can still use a full-width action', () => {
  assert.match(css, /#controls:has\(#rankingControls:not\(\[hidden\]\)\)/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) minmax\(220px, 280px\) auto !important/);
  assert.match(css, /#controls:has\(#rankingControls:not\(\[hidden\]\)\) > \.button/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.controls > \.button\s*\{[\s\S]*width:\s*100% !important/);
});

test('long chart legends and dense ranking rows are visually bounded', () => {
  assert.match(css, /#chartLegend span\s*\{[\s\S]*text-overflow:\s*ellipsis !important/);
  assert.match(css, /#likesView \.like-rank-item\s*\{[\s\S]*min-height:\s*56px !important/);
});
