import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const historyEntry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
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

test('dashboard asset dependency chain gives every cacheable asset an explicit version', () => {
  const versions = {
    appLite: assetVersion(html, 'app-lite.css'),
    monochrome: assetVersion(html, 'monochrome.css'),
    entry: assetVersion(html, 'dashboard-metrics.js'),
    header: assetVersion(entry, 'dashboard-header.js'),
    tabs: assetVersion(entry, 'dashboard-tabs.js'),
    firstWeekShell: assetVersion(entry, 'first-week-comparison-shell.js'),
    historyMain: assetVersion(tabs, 'history/history-main.js'),
    legacyListeningPartyRoute: assetVersion(entry, 'legacy-listening-party-route.js'),
    fetchCache: assetVersion(entry, 'dashboard-fetch-cache.js'),
    metricStyle: assetVersion(entry, 'dashboard-current-metric-style.js'),
    unofficialListeningParties: assetVersion(historyEntry, 'unofficial-listening-parties.js'),
    officialListeningPartyCopy: assetVersion(historyEntry, 'official-listening-party-copy.js'),
    dailySummaries: assetVersion(entry, 'dashboard-daily-summaries.js'),
    comparison: assetVersion(entry, 'dashboard-chart-comparison.js'),
    chartDetail: assetVersion(entry, 'dashboard-chart-detail.js'),
    client: assetVersion(entry, 'dashboard-client.js'),
    fixes: assetVersion(header, 'dashboard-fixes.css'),
  };

  assert.equal(versions.entry, '20260927.5');
  assert.equal(versions.header, '20260927.1');
  assert.equal(versions.tabs, '20260927.2');
  assert.equal(versions.firstWeekShell, '20260927.1');
  assert.equal(versions.historyMain, '20260927.1');
  assert.equal(versions.unofficialListeningParties, '20260927.1');
  assert.equal(versions.comparison, '20260927.2');
  assert.equal(versions.chartDetail, '20260927.2');
  for (const [asset, version] of Object.entries(versions)) {
    assert.match(version, /^\d{8}\.\d+$/, `${asset} has an invalid deployment version: ${version}`);
  }
});

test('fixed entry URLs without a version cannot silently return stale layout code', () => {
  assert.doesNotMatch(html, /(?:href|src)="\/(?:app-lite\.css|monochrome\.css|dashboard-metrics\.js)"/);
  assert.doesNotMatch(entry, /(?:from |import\()'\/(?:dashboard-client\.js)'/);
  assert.doesNotMatch(header, /stylesheetHref = '\/dashboard-fixes\.css'/);
});
