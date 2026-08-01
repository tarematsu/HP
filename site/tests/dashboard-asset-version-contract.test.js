import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assetVersion(source, asset) {
  const match = source.match(new RegExp(
    `(?:/|\\./)${escapeRegExp(asset)}\\?v=([^'"\\s)>]+)`,
  ));
  assert.ok(match, `${asset} must use an explicit deployment version`);
  return match[1];
}

test('dashboard asset dependency chain uses one explicit deployment version', () => {
  const versions = [
    assetVersion(html, 'app-lite.css'),
    assetVersion(html, 'dashboard-metrics.js'),
    assetVersion(entry, 'dashboard-header.js'),
    assetVersion(entry, 'dashboard-tabs.js'),
    assetVersion(entry, 'dashboard-daily-summaries.js'),
    assetVersion(entry, 'dashboard-client.js'),
    assetVersion(header, 'dashboard-fixes.css'),
  ];

  assert.equal(new Set(versions).size, 1, `dashboard assets use mixed versions: ${versions.join(', ')}`);
});

test('fixed entry URLs without a version cannot silently return stale layout code', () => {
  assert.doesNotMatch(html, /(?:href|src)="\/(?:app-lite\.css|dashboard-metrics\.js)"/);
  assert.doesNotMatch(entry, /(?:from |import\()'\/(?:dashboard-client\.js)'/);
  assert.doesNotMatch(header, /stylesheetHref = '\/dashboard-fixes\.css'/);
});
