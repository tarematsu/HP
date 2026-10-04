import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const navigationCss = readFileSync(new URL('../public/dashboard-navigation.css', import.meta.url), 'utf8');
const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const nogizakaShell = readFileSync(new URL('../public/nogizaka-listening-party-shell.js', import.meta.url), 'utf8');
const youtubeRuntime = readFileSync(new URL('../public/youtube-music.js', import.meta.url), 'utf8');

test('responsive source rows keep shared sizing while avoiding tablet overlap', () => {
  assert.match(navigationCss, /\.dashboard-source-tabs > button,\s*\.dashboard-source-row > button\s*\{[^}]*min-height:\s*36px[^}]*padding:\s*6px 10px/s);
  assert.match(navigationCss, /\.dashboard-source-tabs > button\s*\{[^}]*flex:\s*1 1 0/s);
  assert.match(navigationCss, /\.dashboard-source-row > button\s*\{[^}]*flex:\s*0 0 auto/s);
});

test('Nogizaka chart and empty state stay inside the chart-fit wrapper', () => {
  assert.match(nogizakaShell, /class="chart-fit"><canvas id="nogizakaPartyChart"[^>]*><\/canvas><p id="nogizakaPartyChartEmpty"/);
  assert.match(tabs, /nogizaka-listening-party-shell\.js\?v=20261003\.1/);
});

test('YouTube Music renders unknown release types as missing values and busts the runtime cache', () => {
  assert.match(youtubeRuntime, /text\.toLowerCase\(\) === 'unknown' \? '-' : text/);
  assert.match(youtubeRuntime, /optionalText\(item\.release_type\)/);
  assert.match(tabs, /youtube-music\.js\?v=20261004\.2/);
});