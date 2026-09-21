import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const summary = readFileSync(new URL('../public/history/history-broadcast-summary.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');

test('official listening party summary shows maximum concurrency and average duration', () => {
  assert.match(summary, /setText\('streamLabel', '最大同接'\)/);
  assert.match(summary, /setText\('memberLabel', '平均時間'\)/);
  assert.match(summary, /Math\.max\(\.\.\.maximums\)/);
  assert.match(summary, /\(endedAt - startedAt\) \/ 60_000/);
  assert.match(summary, /durations\.reduce\(\(sum, value\) => sum \+ value, 0\) \/ durations\.length/);
});

test('official listening party summary hook loads before the compact history runtime', () => {
  const summaryIndex = main.indexOf("history-broadcast-summary.js");
  const historyIndex = main.indexOf("history-lite.js");
  assert.ok(summaryIndex >= 0);
  assert.ok(historyIndex > summaryIndex);
});
