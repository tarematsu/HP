import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboardEntry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const headerRepair = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const headerCss = readFileSync(new URL('../public/dashboard-fixes.css', import.meta.url), 'utf8');
const historyEntry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');

test('dashboard header repair runs before tabs and dashboard client startup', () => {
  assert.ok(dashboardEntry.indexOf("import './dashboard-header.js'") < dashboardEntry.indexOf("import './dashboard-tabs.js'"));
  assert.match(headerRepair, /description\.replaceWith\(updated\)/);
  assert.match(headerRepair, /querySelector\('\.live-line'\)\?\.remove\(\)/);
  assert.match(headerRepair, /querySelector\('\.app-launch'\)\?\.remove\(\)/);
  assert.match(headerRepair, /actions\.replaceWith\(tabs\)/);
});

test('mobile dashboard header has no vertical flex basis', () => {
  assert.match(headerCss, /\.dashboard-header \.channel[\s\S]*flex: 1 1 auto/);
  assert.match(headerCss, /@media \(max-width: 760px\)[\s\S]*\.dashboard-header \.channel,[\s\S]*\.mode-tabs\.dashboard-tabs[\s\S]*flex: none/);
  assert.doesNotMatch(headerCss, /flex:\s*1 1 (?:360|560)px/);
});

test('mobile metrics share one row at equal widths with compact text', () => {
  assert.match(headerCss, /\.metrics\s*\{[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(headerCss, /\.metric\.featured\s*\{[\s\S]*grid-column:\s*auto[\s\S]*display:\s*block/);
  assert.match(headerCss, /\.metric strong,[\s\S]*\.metric\.featured strong\s*\{[\s\S]*font-size:\s*clamp\(1rem, 4\.8vw, 1\.5rem\)/);
  assert.match(headerCss, /\.metric > span\s*\{[\s\S]*font-size:\s*clamp\(\.58rem, 2\.4vw, \.68rem\)/);
});

test('integrated history creates inert removed-control compatibility before loading legacy runtime', () => {
  assert.match(historyEntry, /installRemovedControlCompatibility\(\)/);
  assert.ok(historyEntry.indexOf('installRemovedControlCompatibility();') < historyEntry.indexOf("await import('/history/history-lite.js')"));
  for (const suffix of ['Controls', 'Date', 'WeekMode']) {
    assert.match(historyEntry, new RegExp(`\\['track', '${suffix}'\\]\\.join\\(''\\)`));
  }
  assert.match(historyEntry, /node\.hidden = true/);
});