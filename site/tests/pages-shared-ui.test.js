import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sharedUi = readFileSync(new URL('../public/dashboard-ui-common.js', import.meta.url), 'utf8');
const sharedCss = readFileSync(new URL('../public/dashboard-ui-common.css', import.meta.url), 'utf8');
const sharedRoute = readFileSync(new URL('../public/dashboard-standalone-route.js', import.meta.url), 'utf8');
const historyToggle = readFileSync(new URL('../public/history/history-past-toggle-shell.js', import.meta.url), 'utf8');

const shellFiles = [
  'hinata-shell.js',
  'followers-shell.js',
  'spotify-shell.js',
  'apple-music-shell.js',
  'amazon-music-shell.js',
  'played-tracks-shell.js',
  'first-week-comparison-shell.js',
];
const shells = Object.fromEntries(shellFiles.map((file) => [
  file,
  readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8'),
]));

const hinataRoute = readFileSync(new URL('../public/dashboard-hinata-route.js', import.meta.url), 'utf8');
const followersRoute = readFileSync(new URL('../public/dashboard-followers-route.js', import.meta.url), 'utf8');
const hinataCss = readFileSync(new URL('../public/hinata.css', import.meta.url), 'utf8');
const followersCss = readFileSync(new URL('../public/followers.css', import.meta.url), 'utf8');
const amazonCss = readFileSync(new URL('../public/amazon-music.css', import.meta.url), 'utf8');
const appleCss = readFileSync(new URL('../public/apple-music.css', import.meta.url), 'utf8');

test('lazy dashboard shells share one stylesheet, tab and view mounting implementation', () => {
  assert.match(sharedUi, /export function ensureStylesheet/);
  assert.match(sharedUi, /export function mountDashboardTab/);
  assert.match(sharedUi, /export function mountDashboardView/);
  assert.match(sharedUi, /export function mountDashboardShell/);

  for (const [name, source] of Object.entries(shells)) {
    assert.match(source, /dashboard-ui-common\.js\?v=20260930\.1/, `${name} must import shared UI helpers`);
    assert.match(source, /mountDashboardShell\(/, `${name} must use the common shell mount`);
    assert.doesNotMatch(source, /function ensureStylesheet\s*\(/, `${name} must not reimplement stylesheet loading`);
    assert.doesNotMatch(source, /function mountTab\s*\(/, `${name} must not reimplement tab mounting`);
    assert.doesNotMatch(source, /function mountView\s*\(/, `${name} must not reimplement view mounting`);
  }
});

test('standalone lazy tabs share route activation and navigation handling', () => {
  assert.match(sharedRoute, /export function registerStandaloneDashboardRoute/);
  for (const [name, source] of Object.entries({ hinataRoute, followersRoute })) {
    assert.match(source, /dashboard-standalone-route\.js\?v=20260930\.1/, `${name} must import shared routing`);
    assert.match(source, /registerStandaloneDashboardRoute\(/);
    assert.doesNotMatch(source, /addEventListener\('popstate'/);
    assert.doesNotMatch(source, /addEventListener\('hashchange'/);
    assert.doesNotMatch(source, /document\.addEventListener\('click'/);
  }
});

test('shared feature CSS owns generic SVG and numeric-table primitives', () => {
  assert.match(sharedCss, /\.shared-svg-chart\s*\{/);
  assert.match(sharedCss, /\.shared-svg-chart svg\s*\{/);
  assert.match(sharedCss, /\.shared-numeric-table th/);
  assert.match(sharedCss, /font-variant-numeric:\s*tabular-nums/);

  for (const [name, source] of Object.entries({ hinataCss, followersCss, amazonCss, appleCss })) {
    assert.doesNotMatch(source, /\.\w+-view\s*\{[^}]*display:\s*grid/, `${name} must use canonical dashboard view layout`);
    assert.doesNotMatch(source, /\.\w+-view\[hidden\]/, `${name} must use canonical hidden-view behavior`);
  }
});

test('history feature shells reuse the common stylesheet loader', () => {
  assert.match(historyToggle, /dashboard-ui-common\.js\?v=20260930\.1/);
  assert.match(historyToggle, /ensureStylesheet\('\/history\/history-past-toggle\.css/);
  assert.doesNotMatch(historyToggle, /function ensureStylesheet\s*\(/);
});
