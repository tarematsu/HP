import { browserSource } from './helpers/dashboard-source.js';
import { runInNewContext } from 'node:vm';
import { dashboardRouterSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const buildScript = readFileSync(new URL('../scripts/build-public-assets.mjs', import.meta.url), 'utf8');
const tabs = dashboardRouterSource();
const styles = readFileSync(new URL('../public/dashboard-styles.js', import.meta.url), 'utf8');
const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const common = readFileSync(new URL('../public/dashboard-ui-common.js', import.meta.url), 'utf8');
const rangeNavigator = readFileSync(new URL('../public/history/history-range-navigator.js', import.meta.url), 'utf8');
const currentChart = browserSource('stationhead-channel.js');
const firstWeekChart = readFileSync(new URL('../public/first-week-comparison.js', import.meta.url), 'utf8');
const periodChart = readFileSync(new URL('../public/history/history-period-chart.js', import.meta.url), 'utf8');
const rankingChart = browserSource('leaderboard.js');

function assetVersion(source, asset) {
  const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped}\\?v=([^'"\\s)>\x60]+)`));
  assert.ok(match, `${asset} must use an explicit deployment version`);
  return match[1];
}

test('dashboard HTML ships one core CSS and one JavaScript entry', () => {
  const styles = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g)].map((match) => match[1]);
  const modules = [...html.matchAll(/<script\s+type="module"\s+src="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(styles.length, 1);
  assert.equal(modules.length, 1);
  assert.match(styles[0], /^\/assets\/dashboard\.min\.css\?v=\d{8}\.\d+$/);
  assert.match(modules[0], /^\/assets\/dashboard\.min\.js\?v=\d{8}\.\d+$/);
  assert.equal(assetVersion(html, 'assets/dashboard.min.css'), assetVersion(html, 'assets/dashboard.min.js'));
  assert.match(html, /data-dashboard-css-bundled="true"/);
  assert.doesNotMatch(html, /stationhead\.min\.css|subscriptions\.min\.css/);
  assert.doesNotMatch(html, /(?:app-lite|monochrome|dashboard-presentation|dashboard-metrics)\.(?:css|js)\?v=/);
});

test('route CSS uses the same deployment version and is loaded centrally', async () => {
  const version = assetVersion(html, 'assets/dashboard.min.css');
  assert.match(styles, /querySelector\('link\[href\*="\/assets\/dashboard\.min\.css"\]'/);
  assert.match(styles, /searchParams\.get\('v'\)/);
  assert.match(styles, /encodeURIComponent\(version\)/);
  assert.match(styles, /\/assets\/\$\{section\}\.min\.css/);
  assert.match(tabs, /ensureDashboardSectionStyles/);
  assert.match(tabs, /function ensureModeStyles\(mode\)/);
  const links = [];
  const context = {
    URL,
    location: { href: 'https://pages.test/' },
    document: {
      querySelector: () => ({ href: `https://pages.test/assets/dashboard.min.css?v=${version}` }),
      createElement: () => ({ dataset: {}, addEventListener(event, callback) { if (event === 'load') this.loaded = callback; } }),
      head: { append(link) { links.push(link); queueMicrotask(link.loaded); } },
    },
  };
  runInNewContext(styles.replace(/^export /gm, ''), context);
  for (const section of ['stationhead', 'subscriptions']) {
    await context.ensureDashboardSectionStyles(section);
    await context.ensureDashboardSectionStyles(section);
  }
  assert.deepEqual(links.map(link => link.href), [
    `/assets/stationhead.min.css?v=${version}`, `/assets/subscriptions.min.css?v=${version}`,
  ]);
  assert.match(styles, /document\.createElement\('link'\)/);
  assert.match(styles, /dataset\.dashboardSectionStyle/);
});

test('build minifies dashboard and official entry points with shared CSS groups', () => {
  assert.match(buildScript, /entryPoints:[\s\S]*'dashboard\.min': resolve\(publicRoot, 'dashboard-metrics\.js'\)[\s\S]*'official-account-live\.min'/);
  assert.match(buildScript, /outdir:\s*assetsDir/);
  assert.match(buildScript, /bundle:\s*true/);
  assert.match(buildScript, /splitting:\s*true/);
  assert.match(buildScript, /minify:\s*true/);
  assert.match(buildScript, /const cssGroups = Object\.freeze\(\{/);
  for (const group of ['dashboard', 'stationhead', 'subscriptions']) assert.match(buildScript, new RegExp(`${group}: \\[`));
  for (const css of [
    'app-lite.css', 'dashboard-presentation.css', 'pages-layout.css', 'dashboard-ui-common.css',
    'first-week-comparison.css', 'played-tracks.css', 'followers.css', 'hinata.css', 'spotify.css',
    'apple-music.css', 'amazon-music.css', 'music-service-common.css',
  ]) assert.match(buildScript, new RegExp(css.replaceAll('.', '\\.')));
  assert.doesNotMatch(buildScript, /regional-music\.css/);
  assert.match(buildScript, /buildCssBundle\(name, files\)/);
  assert.match(buildScript, /stationhead_css_bytes/);
  assert.match(buildScript, /subscriptions_css_bytes/);
  assert.match(buildScript, /total_css_bytes/);
  assert.doesNotMatch(buildScript, /optimizeBundled|shareCommonUiHelpers|canvasTransforms|onLoad\(/);
});

test('feature stylesheet loading exists only in the central route client', () => {
  assert.match(styles, /createElement\('link'\)/);
  assert.doesNotMatch(header, /createElement\('link'\)|stylesheet|\.css\?v=/);
  assert.doesNotMatch(common, /ensureStylesheet|createElement\('link'\)|\.css\?v=/);
  assert.doesNotMatch(rangeNavigator, /ensureStylesheet|createElement\('link'\)|\.css\?v=/);
});

test('Canvas chart normalization lives in active source modules instead of build transforms', () => {
  assert.match(currentChart, /context\.font = '11px system-ui'/);
  assert.match(currentChart, /drawOnlineSeries\(context, rows, x, y, '#111', 2\)/);
  assert.match(firstWeekChart, /context\.font = '11px system-ui'/);
  assert.match(firstWeekChart, /lineWidth: 2/);
  assert.match(firstWeekChart, /drawDashboardLine/);
  assert.match(periodChart, /context\.font = '11px system-ui'/);
  assert.match(periodChart, /width: 2/);
  assert.match(rankingChart, /context\.font = '11px system-ui'/);
  assert.match(rankingChart, /lineWidth: 2/);
  assert.match(rankingChart, /context\.arc\(positions\[rowIndex\], yFor\(row\.rank\), 3,/);
});
