import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/hinata-shell.js', import.meta.url), 'utf8');
const followersShell = readFileSync(new URL('../public/followers-shell.js', import.meta.url), 'utf8');
const missing = readFileSync(new URL('../public/hinata-missing-periods.js', import.meta.url), 'utf8');

test('Ohisama and followers chart headers omit update-time pills', () => {
  assert.doesNotMatch(shell, /hinataUpdated|trailingHtml/);
  assert.doesNotMatch(followersShell, /followersLatestDate|trailingHtml/);
  assert.match(entry, /hinata-shell\.js\?v=20261001\.1/);
  assert.match(entry, /followers-shell\.js\?v=20261001\.1/);
});

test('Ohisama daily chart marks date gaps with the same missing-period treatment as history', () => {
  assert.match(shell, /hinata-missing-periods\.js\?v=20261001\.1/);
  assert.match(missing, /export function missingDailyRanges/);
  assert.match(missing, /next - previous <= DAY_MS/);
  assert.match(missing, /rgba\(100, 107, 116, \.16\)/);
  assert.match(missing, /document\.createTextNode\('欠測'\)/);
  assert.match(missing, /data-hinata-missing-band/);
  assert.match(missing, /MutationObserver/);
});
