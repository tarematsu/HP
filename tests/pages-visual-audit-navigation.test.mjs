import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { auditRoutes } from '../scripts/capture-pages-visual-audit.mjs';
import { ROUTES } from '../site/public/dashboard-navigation-config.js';

const source = readFileSync(new URL('../scripts/capture-pages-visual-audit.mjs', import.meta.url), 'utf8');
test('visual audit covers every registered route across all sources', () => {
  const routes = auditRoutes();
  assert.deepEqual(routes.map(({ mode }) => mode).sort(), Object.keys(ROUTES).sort());
  assert.equal(new Set(routes.map(({ mode }) => mode)).size, routes.length);
  assert.ok(routes.some(({ source, mode }) => source === 'hinata' && mode === 'hinata'));
  assert.ok(routes.some(({ source }) => source === 'kugou_music'));
});
test('visual audit uses current navigation and retains screenshots when a route fails', () => {
  assert.doesNotMatch(source, /#modeTabs/);
  assert.match(source, /#sectionTabs button/);
  assert.match(source, /response.status\(\) >= 400/);
  assert.match(source, /views.push\(\{ tab, viewport: viewport.name, screenshot, ok: false/);
});

test('visual audit waits for history data and fresh chart paint before recording a successful screenshot', () => {
  assert.match(source, /history:data-loaded/);
  assert.match(source, /history:period-chart-drawn/);
  assert.ok(source.includes('window.__pagesAuditHistory'));
  assert.match(source, /historyWaitTimedOut/);
  assert.match(source, /history summary returned no rows/);
});
