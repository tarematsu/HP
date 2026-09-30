import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const historyShellSource = readFileSync(
  new URL('../public/history-shell.js', import.meta.url),
  'utf8',
);
const navigatorSource = readFileSync(
  new URL('../public/history/history-range-navigator.js', import.meta.url),
  'utf8',
);
const historyEntry = readFileSync(
  new URL('../public/history/history-main.js', import.meta.url),
  'utf8',
);

test('history range controls render their final UI without flashing legacy date controls', () => {
  assert.match(historyShellSource, />1ヶ月<\/button>/);
  assert.match(historyShellSource, />半年<\/button>/);
  assert.match(historyShellSource, />1年<\/button>/);
  assert.match(historyShellSource, />全期間<\/button>/);
  assert.match(historyShellSource, /id="from" type="hidden"/);
  assert.match(historyShellSource, /id="to" type="hidden"/);
  assert.match(historyShellSource, /id="load" type="button" hidden/);
  assert.doesNotMatch(historyShellSource, /class="date-range"/);
  assert.doesNotMatch(historyShellSource, /type="date"/);
  assert.doesNotMatch(historyShellSource, />更新<\/button>/);
  assert.doesNotMatch(navigatorSource, /dateRange\.hidden|loadButton\.hidden|button\.textContent = period\.label/);
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