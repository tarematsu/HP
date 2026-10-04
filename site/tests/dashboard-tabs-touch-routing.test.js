import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const registry = readFileSync(new URL('../public/dashboard-tab-registry.js', import.meta.url), 'utf8');
const tabsClient = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');

test('history-backed visible tabs route by data-mode while leaderboard stays source-only', () => {
  for (const mode of ['daily', 'broadcasts']) {
    assert.match(registry, new RegExp(`view: 'history', mode: '${mode}'`));
  }
  assert.doesNotMatch(registry, /mode: 'ranking'/);
  assert.match(tabsClient, /id: 'ranking', label: 'リーダーボード', defaultMode: 'ranking'/);
  assert.match(tabsClient, /return button\?\.dataset\.mode \|\| button\?\.dataset\.view \|\| '';/);
  assert.match(tabsClient, /const mode = routeModeForButton\(button\);/);
  assert.doesNotMatch(tabsClient, /return button\?\.dataset\.view \|\| button\?\.dataset\.mode/);
});
