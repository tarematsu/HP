import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const navigatorSource = readFileSync(
  new URL('../public/history/history-range-navigator.js', import.meta.url),
  'utf8',
);
const historyEntry = readFileSync(
  new URL('../public/history/history-main.js', import.meta.url),
  'utf8',
);

test('history range controls expose only the four simplified period choices', () => {
  assert.match(navigatorSource, /label: '1ヶ月', months: 1/);
  assert.match(navigatorSource, /label: '半年', months: 6/);
  assert.match(navigatorSource, /label: '1年', months: 12/);
  assert.match(navigatorSource, /label: '全期間', months: null/);
  assert.match(navigatorSource, /dateRange\.hidden = true/);
  assert.match(navigatorSource, /loadButton\.hidden = true/);
});

test('history range arrows move by half of the current visible span and clamp to data bounds', () => {
  assert.match(navigatorSource, /Math\.floor\(spanDays \/ 2\)/);
  assert.match(navigatorSource, /if \(nextFrom < earliest\)/);
  assert.match(navigatorSource, /if \(nextTo > latest\)/);
  assert.match(navigatorSource, /historyRangePrevious/);
  assert.match(navigatorSource, /historyRangeNext/);
  assert.match(navigatorSource, /activePeriod !== 'all'/);
});

test('period changes can restart loading even while the hidden load button is disabled', () => {
  assert.match(navigatorSource, /loadButton\.dispatchEvent\(new Event\('click'/);
});

test('range navigator loads before compact history runtime so it can own preset clicks', () => {
  const navigatorIndex = historyEntry.indexOf('history-range-navigator.js');
  const runtimeIndex = historyEntry.indexOf('history-lite.js');
  assert.ok(navigatorIndex >= 0);
  assert.ok(runtimeIndex >= 0);
  assert.ok(navigatorIndex < runtimeIndex);
});
