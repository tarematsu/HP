import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const version = '20260731.1';
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');

test('dashboard asset dependency chain uses one explicit deployment version', () => {
  assert.match(html, new RegExp(`/app-lite\\.css\\?v=${version}`));
  assert.match(html, new RegExp(`/dashboard-metrics\\.js\\?v=${version}`));
  for (const asset of [
    'dashboard-header.js',
    'dashboard-tabs.js',
    'dashboard-daily-summaries.js',
    'dashboard-client.js',
  ]) {
    assert.match(entry, new RegExp(`${asset.replace('.', '\\.')}\\?v=${version}`));
  }
  assert.match(header, new RegExp(`/dashboard-fixes\\.css\\?v=${version}`));
});

test('fixed entry URLs without a version cannot silently return stale layout code', () => {
  assert.doesNotMatch(html, /(?:href|src)="\/(?:app-lite\.css|dashboard-metrics\.js)"/);
  assert.doesNotMatch(entry, /(?:from |import\()'\/(?:dashboard-client\.js)'/);
  assert.doesNotMatch(header, /stylesheetHref = '\/dashboard-fixes\.css'/);
});
