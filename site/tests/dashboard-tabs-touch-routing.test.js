import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const registry = readFileSync(new URL('../public/dashboard-tab-registry.js', import.meta.url), 'utf8');
const tabsClient = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');

test('history-backed tabs route by data-mode before their shared history view', () => {
  for (const mode of ['daily', 'ranking', 'broadcasts']) {
    assert.match(registry, new RegExp(`view: 'history', mode: '${mode}'`));
  }
  assert.match(tabsClient, /const mode = button\.dataset\.mode \|\| button\.dataset\.view;/);
  assert.doesNotMatch(tabsClient, /const mode = button\.dataset\.view \|\| button\.dataset\.mode;/);
});