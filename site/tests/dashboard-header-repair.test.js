import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const dashboardEntry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const headerRepair = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const headerCss = readFileSync(new URL('../public/dashboard-fixes.css', import.meta.url), 'utf8');
const finalFixes = readFileSync(new URL('../public/pages-layout-final-fixes.css', import.meta.url), 'utf8');
const historyEntry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const historyClient = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');

test('dashboard header starts in its final DOM shape before tabs and dashboard client startup', () => {
  const headerImport = dashboardEntry.match(/import '\.\/dashboard-header\.js\?v=[^']+'/)?.[0];
  const tabsImport = dashboardEntry.match(/import '\.\/dashboard-tabs\.js\?v=[^']+'/)?.[0];
  assert.ok(headerImport, 'dashboard-header.js must have an explicit deployment version');
  assert.ok(tabsImport, 'dashboard-tabs.js must have an explicit deployment version');
  assert.ok(dashboardEntry.indexOf(headerImport) < dashboardEntry.indexOf(tabsImport));
  assert.match(headerRepair, /dashboard-fixes\.css\?v=[^']+/);
  assert.match(headerRepair, /pages-layout-final-fixes\.css\?v=20260925\.1/);
  assert.match(page, /<p id="updated" class="subtle">-<\/p>/);
  assert.match(page, /<nav id="modeTabs" class="mode-tabs dashboard-tabs"/);
  assert.doesNotMatch(page, /id="description"|class="live-line"|class="app-launch"|class="dashboard-actions"/);
  assert.doesNotMatch(headerRepair, /description\.replaceWith|querySelector\('\.live-line'\)|querySelector\('\.app-launch'\)|actions\.replaceWith/);
});

test('mobile dashboard header has no vertical flex basis', () => {
  assert.match(headerCss, /\.dashboard-header \.channel[\s\S]*flex: 1 1 auto/);
  assert.match(headerCss, /@media \(max-width: 760px\)[\s\S]*\.dashboard-header \.channel,[\s\S]*\.mode-tabs\.dashboard-tabs[\s\S]*flex: none/);
  assert.doesNotMatch(headerCss, /flex:\s*1 1 (?:360|560)px/);
});

test('current metric panels resolve to one full-width column while keeping compact mobile text', () => {
  assert.match(finalFixes, /#currentView > \.metrics\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) !important/);
  assert.match(headerCss, /\.metric\.featured\s*\{[\s\S]*grid-column:\s*auto[\s\S]*display:\s*block/);
  assert.match(headerCss, /\.metric strong,[\s\S]*\.metric\.featured strong\s*\{[\s\S]*font-size:\s*clamp\(\.94rem, 4\.3vw, 1\.42rem\)/);
  assert.match(headerCss, /\.metric > span\s*\{[\s\S]*font-size:\s*clamp\(\.58rem, 2\.4vw, \.68rem\)/);
});

test('dashboard navigation and likes summary remain balanced across breakpoints', () => {
  assert.match(headerCss, /\.mode-tabs\.dashboard-tabs\s*\{[\s\S]*grid-template-columns:\s*repeat\(7, minmax\(0, 1fr\)\)/);
  assert.match(headerCss, /@media \(max-width: 430px\)[\s\S]*grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(headerCss, /button:last-child\s*\{[\s\S]*grid-column:\s*1 \/ -1/);
  assert.match(headerCss, /\.summary-cards\.likes-summary\s*\{[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(headerCss, /\.summary-cards\.likes-summary article:last-child\s*\{[\s\S]*grid-column:\s*1 \/ -1/);
});

test('hash navigation hides skip-link focus until a real Tab focuses the skip link', () => {
  assert.match(headerCss, /html:not\(\.keyboard-navigation\) \.skip-link\s*\{[\s\S]*opacity:\s*0[\s\S]*translateY\(-150%\)/);
  assert.match(headerCss, /html\.keyboard-navigation \.skip-link:focus\s*\{[\s\S]*opacity:\s*1[\s\S]*transform:\s*none/);
  assert.match(headerRepair, /event\.key !== 'Tab' \|\| !event\.isTrusted/);
  assert.match(headerRepair, /document\.activeElement !== skipLink/);
  assert.match(headerRepair, /focusout/);
  assert.match(headerRepair, /pointerdown/);
});

test('integrated history no longer creates compatibility controls for the removed track mode', () => {
  assert.doesNotMatch(historyEntry, /installRemovedControlCompatibility|trackDate|trackWeekMode|trackControls/);
  assert.doesNotMatch(historyClient, /trackDate|trackWeekMode|trackControls|TRACK_COLUMNS|mode === 'tracks'/);
  assert.match(historyEntry, /window\.__ensureHistoryModeRuntime = ensureHistoryModeRuntime/);
});
