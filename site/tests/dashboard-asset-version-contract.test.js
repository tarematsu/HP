import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const buildScript = readFileSync(new URL('../scripts/build-public-assets.mjs', import.meta.url), 'utf8');
const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const common = readFileSync(new URL('../public/dashboard-ui-common.js', import.meta.url), 'utf8');
const rangeNavigator = readFileSync(new URL('../public/history/history-range-navigator.js', import.meta.url), 'utf8');

function assetVersion(source, asset) {
  const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped}\\?v=([^'"\\s)>]+)`));
  assert.ok(match, `${asset} must use an explicit deployment version`);
  return match[1];
}

test('dashboard ships one CSS and one JavaScript browser asset', () => {
  const styles = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g)].map((match) => match[1]);
  const modules = [...html.matchAll(/<script\s+type="module"\s+src="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(styles, ['/assets/dashboard.min.css?v=20260930.1']);
  assert.deepEqual(modules, ['/assets/dashboard.min.js?v=20260930.1']);
  assert.match(html, /data-dashboard-css-bundled="true"/);
  assert.match(assetVersion(html, 'assets/dashboard.min.css'), /^\d{8}\.\d+$/);
  assert.match(assetVersion(html, 'assets/dashboard.min.js'), /^\d{8}\.\d+$/);
  assert.doesNotMatch(html, /(?:app-lite|monochrome|dashboard-root-presentation|dashboard-metrics)\.(?:css|js)\?v=/);
});

test('build collapses the complete module graph and feature styles into minified assets', () => {
  assert.match(buildScript, /entryPoints:\s*\[resolve\(publicRoot, 'dashboard-metrics\.js'\)\]/);
  assert.match(buildScript, /outfile:\s*resolve\(assetsDir, 'dashboard\.min\.js'\)/);
  assert.match(buildScript, /bundle:\s*true/);
  assert.match(buildScript, /splitting:\s*false/);
  assert.match(buildScript, /minify:\s*true/);
  assert.match(buildScript, /outfile:\s*resolve\(assetsDir, 'dashboard\.min\.css'\)/);
  for (const css of [
    'app-lite.css',
    'dashboard-root-presentation.css',
    'pages-layout.css',
    'spotify.css',
    'apple-music.css',
    'amazon-music.css',
    'followers.css',
    'hinata.css',
    'dashboard-ui-common.css',
  ]) assert.match(buildScript, new RegExp(css.replaceAll('.', '\\.')));
  assert.ok(
    buildScript.lastIndexOf("'dashboard-ui-common.css'") > buildScript.indexOf("'hinata.css'"),
    'shared presentation contract must be last in the CSS bundle',
  );
});

test('bundled pages never request feature styles at runtime', () => {
  assert.match(header, /dataset\.dashboardCssBundled !== 'true'/);
  assert.match(common, /dataset\.dashboardCssBundled === 'true'\) return null/);
  assert.match(rangeNavigator, /dataset\.dashboardCssBundled === 'true'\) return/);
});

test('Canvas chart normalization is part of the production bundle build', () => {
  for (const file of [
    'dashboard-chart-comparison.js',
    'first-week-comparison.js',
    'history-period-chart.js',
    'history-ranking-chart.js',
  ]) assert.match(buildScript, new RegExp(file.replaceAll('.', '\\.')));
  assert.match(buildScript, /11px system-ui/);
  assert.match(buildScript, /context\.lineWidth = 2;/);
  assert.match(buildScript, /context\.arc\(positions\[index\], yFor\(rank\), 3,/);
});
