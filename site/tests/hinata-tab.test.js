import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const route = readFileSync(new URL('../public/dashboard-hinata-route.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/hinata-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/hinata.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/hinata.css', import.meta.url), 'utf8');
const api = readFileSync(new URL('../functions/api/hinata.js', import.meta.url), 'utf8');

test('Pages mounts a dedicated Hinata dashboard tab after Amazon Music', () => {
  assert.match(metrics, /dashboard-hinata-route\.js/);
  assert.match(shell, /dataset\.view = 'hinata'/);
  assert.match(shell, /\[data-view="amazon-music"\]/);
  assert.match(shell, /const anchor = amazonMusic \|\| spotify/);
  assert.match(shell, /anchor\.insertAdjacentElement\('afterend', button\)/);
  assert.match(shell, /日向坂/);
  assert.match(shell, /オンライン/);
  assert.match(shell, /総再生数/);
  assert.match(shell, /総メンバー数/);
  assert.match(shell, /日次データ/);
  assert.match(route, /#hinata/);
});

test('Hinata tab reuses the shared current and history layout system', () => {
  assert.match(shell, /class="metrics hinata-metrics"/);
  assert.match(shell, /class="metric hinata-metric"/);
  assert.match(shell, /class="section-head chart-head hinata-section-head"/);
  assert.match(shell, /class="legend hinata-legend"/);
  assert.match(shell, /class="chart-detail subtle hinata-chart-detail"/);
  assert.match(shell, /class="card data-panel hinata-daily-panel"/);
  assert.doesNotMatch(css, /font-size:/);
  assert.doesNotMatch(css, /padding:/);
});

test('Hinata tab reads only the materialized model API', () => {
  assert.match(runtime, /fetch\(HINATA_URL/);
  assert.match(runtime, /\/api\/hinata/);
  assert.match(api, /PAGES_READ_MODEL_SERVICE/);
  assert.match(api, /_internal\/pages-response/);
  assert.match(api, /HINATA_MODEL_KEY = 'hinata'/);
  assert.doesNotMatch(api, /\.prepare\(|OHISAMA_DB|MINUTE_DB|OTHER_DB/);
});

test('Hinata graph is rendered as five-minute buckets with actual five-minute stream growth', () => {
  assert.match(runtime, /const FIVE_MINUTES_MS = 5 \* 60_000/);
  assert.match(runtime, /Math\.floor\(observedAt \/ FIVE_MINUTES_MS\) \* FIVE_MINUTES_MS/);
  assert.match(runtime, /point\.bucket - previous\.bucket === FIVE_MINUTES_MS/);
  assert.match(runtime, /point\.stream_count - previous\.stream_count/);
  assert.match(shell, />再生数増加</);
  assert.doesNotMatch(shell, /5分平均の再生増加/);
});

test('Hinata daily table includes cumulative stream and member totals', () => {
  assert.match(shell, /<th>総再生数<\/th><th>再生数増加<\/th><th>総メンバー数<\/th><th>メンバー増加<\/th>/);
  assert.match(runtime, /numberText\(item\?\.stream_end\)/);
  assert.match(runtime, /numberText\(item\?\.member_end\)/);
  assert.match(runtime, /cell\.colSpan = 8/);
});

test('Hinata UI includes the 24-hour online and playback graph plus daily metrics', () => {
  assert.match(runtime, /history_24h/);
  assert.match(runtime, /stream_delta_5m/);
  assert.match(runtime, /listener_avg/);
  assert.match(runtime, /stream_growth/);
  assert.match(runtime, /member_growth/);
});
