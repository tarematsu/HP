import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/genie-catalog-ui.js', import.meta.url), 'utf8');

test('Genie tab uses the Korean official service name and QQ-style compact shell', () => {
  assert.match(html, /data-source="genie">🇰🇷지니뮤직<\/button>/);
  assert.match(html, /\/genie-catalog-ui\.js\?v=20261003\.1/);
  assert.match(runtime, /const SERVICE_TITLE = '지니뮤직'/);
  assert.match(runtime, /const CADENCE = '毎週月曜日0:00'/);
  assert.match(runtime, /class="music-service-section regional-chart-section"/);
  assert.match(runtime, /class="mode-tabs regional-chart-filter"/);
  assert.match(runtime, /class="regional-music-table regional-music-qq-popularity-table music-service-track-table"/);
  assert.match(runtime, /<th>グループ<\/th><th>順位<\/th><th>曲名<\/th><th>再生数<\/th><th>リスナー<\/th><th>いいね<\/th>/);
  assert.match(runtime, /fetch\('\/api\/regional-music\?service=genie'/);
  assert.match(runtime, /payload\?\.artist_track_orders/);
  assert.match(runtime, /payload\?\.tracks/);
  assert.match(runtime, /data-genie-artist-filter="sakurazaka46"/);
  assert.match(runtime, /data-genie-artist-filter="nogizaka46"/);
  assert.match(runtime, /data-genie-artist-filter="hinatazaka46"/);
  assert.match(runtime, /genericTables\.hidden = true/);
  assert.match(runtime, /compactMeta\.hidden = false/);
});
