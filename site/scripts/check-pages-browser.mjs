// Browser regression for route ownership, responsive layouts, live data and downloads.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve('site/public');
const live = process.argv.includes('--live');
const output = resolve(`site/artifacts/${live ? 'browser-live' : 'browser'}`);
const snapshots = new Map();
const apiResults = [];
await mkdir(output, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
    if (!file.startsWith(`${root}/`)) throw new Error('outside root');
    res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end('Not found'); }
});
await new Promise((resolveServer) => server.listen(0, '127.0.0.1', resolveServer));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const results = [];
const runtimeErrors = [];
const viewports = live
  ? [{ width: 390, height: 960, label: '390' }, { width: 1440, height: 960, label: '1440' }]
  : [{ width: 320, height: 960, label: '320' }, { width: 390, height: 960, label: '390' }, { width: 844, height: 390, label: '844-landscape' }, { width: 1440, height: 960, label: '1440' }];
const modes = ['current', 'daily', 'weekly', 'monthly', 'played-tracks', 'likes', 'broadcasts', 'hinata', 'nogizaka', 'spotify', 'apple-music', 'amazon-music', 'youtube-music', 'kkbox', 'qq_music', 'kugou_music', 'ranking', 'followers'];
const stationheadFunctions = ['現在', '日次', '週次', '月次', '再生履歴', 'いいね', 'リスパ', 'リーダーボード', 'フォロワー'];

function emptyFixture() {
  return {
    ok: true,
    rows: [], history: [], dates: [], artists: [], tracks: [], ranking: [], series: [], items: [], latest: {},
    queue: [{ is_current: true, title: '非常に長い曲名を使ったレイアウト回帰テスト用トラックタイトル', artist: 'テストアーティスト', thumbnail_url: '/missing-artwork.jpg', duration_ms: 240000 }],
    queue_status: { current_index: 0, returned_items: 1, total_items: 1, playing: false },
  };
}

async function checkCsv(page, label) {
  const downloads = [];
  for (const button of await page.locator('.dashboard-view:not([hidden]) :is(.csv-button, #csv, #likesCsv):visible:not(:disabled)').all()) {
    const pending = page.waitForEvent('download', { timeout: 5000 });
    await button.click();
    const download = await pending;
    assert.match(download.suggestedFilename(), /\.csv$/i);
    const target = `${output}/${label}-${downloads.length}.csv`;
    await download.saveAs(target);
    const csv = await readFile(target, 'utf8');
    assert.ok(csv.trim().length > 0, 'CSV is empty');
    if (live) assert.ok(csv.trim().split(/\r?\n/).length > 1, 'CSV contains only headers');
    downloads.push({ name: download.suggestedFilename(), bytes: Buffer.byteLength(csv) });
  }
  return downloads;
}

async function assertNoDocumentOverflow(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
  if (overflow) {
    await page.screenshot({ path: `${output}/overflow-${label}.png`, fullPage: true });
    const elements = await page.evaluate(() => [...document.querySelectorAll('body *')].map((node) => ({ tag: node.tagName, id: node.id, className: String(node.className), right: node.getBoundingClientRect().right })).filter((node) => node.right > innerWidth + 2));
    await writeFile(`${output}/overflow-${label}.json`, JSON.stringify(elements, null, 2));
  }
  assert.equal(overflow, false, `${label} overflows the document`);
  return overflow;
}

async function stressVisibleLayout(page, label) {
  await page.evaluate(() => {
    const view = document.querySelector('.dashboard-view:not([hidden])');
    const cell = view?.querySelector('tbody td');
    if (cell) cell.textContent = '9,999,999,999 — 非常に長いテキストでもページ幅を破壊しないことを確認するための表示';
    const legend = view?.querySelector('.legend, .chart-legend');
    if (legend) legend.append(' / 非常に長いイベント名を使った表示崩れ回帰テスト');
  });
  await assertNoDocumentOverflow(page, `${label}-stress`);
}

try {
  for (const viewport of viewports) {
    const { width, height, label: viewportLabel } = viewport;
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', (error) => runtimeErrors.push({ viewport: viewportLabel, message: error.message, url: page.url() }));
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url()); const path = url.pathname + url.search;
      if (!live) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyFixture()) });
      if (!snapshots.has(path)) snapshots.set(path, (async () => {
        const response = await fetch(`https://skrzk.pages.dev${path}`, { signal: AbortSignal.timeout(30000) });
        const body = await response.text(); apiResults.push({ path, status: response.status, capturedAt: new Date().toISOString(), bytes: Buffer.byteLength(body) });
        return { status: response.status, contentType: 'application/json', body };
      })());
      try { await route.fulfill(await snapshots.get(path)); }
      catch (error) { apiResults.push({ path, error: error.message }); await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'snapshot unavailable' }) }); }
    });
    await page.goto(origin);
    for (const mode of modes) {
      await page.evaluate((nextMode) => { location.hash = nextMode; }, mode);
      await page.waitForFunction(() => [...document.querySelectorAll('.dashboard-view')].some((node) => !node.hidden), { timeout: 10000 });
      await page.waitForTimeout(500);
      await page.waitForLoadState('networkidle', { timeout: 45000 });
      const label = `${mode}-${viewportLabel}`;
      const overflow = await assertNoDocumentOverflow(page, label);
      assert.equal(await page.locator('main').count(), 1);
      assert.equal(await page.locator('#sourceTabs').isVisible(), width > 760, `${mode}: selector breakpoint`);
      assert.equal(await page.locator('#sourceSelect').isVisible(), width <= 760, `${mode}: native selector breakpoint`);

      const sourceLabels = width > 760 ? await page.locator('#sourceTabs button').allTextContents() : await page.locator('#sourceSelect option').allTextContents();
      if (['current', 'daily', 'weekly', 'monthly', 'played-tracks', 'likes', 'broadcasts', 'ranking', 'followers', 'hinata', 'nogizaka'].includes(mode)) {
        assert.deepEqual(sourceLabels, ['Buddies', 'Ohisama', 'Nogizaka'], `${mode}: Stationhead targets only`);
      } else {
        assert.deepEqual(sourceLabels, ['Spotify', 'Apple Music', 'Amazon Music', 'YouTube Music', '🇹🇼KKBOX', '🇨🇳QQ音乐', '🇨🇳酷狗音乐'], `${mode}: streaming services only`);
      }
      if (['current', 'daily', 'weekly', 'monthly', 'played-tracks', 'likes', 'broadcasts', 'ranking', 'followers'].includes(mode)) {
        assert.deepEqual(await page.locator('#functionTabs button').allTextContents(), stationheadFunctions, `${mode}: Buddies functions`);
      }
      if (!live && mode === 'current') {
        await page.waitForTimeout(100);
        assert.equal(await page.locator('[data-role="track-image"]').isHidden(), true, 'broken artwork stays hidden');
        assert.equal(await page.locator('.track-fallback').isVisible(), true, 'broken artwork keeps fallback visible');
      }
      if (live && ['daily', 'weekly', 'monthly'].includes(mode)) assert.match(await page.locator('#tbody tr td').first().textContent(), /^\d{4}/, `${mode}: history data did not load`);
      if (!live && width === 320 && ['broadcasts', 'ranking', 'youtube-music', 'kkbox'].includes(mode)) await stressVisibleLayout(page, label);
      await page.screenshot({ path: `${output}/${label}.png`, fullPage: true });
      const downloads = await checkCsv(page, label);
      for (const button of await page.locator('.dashboard-view:not([hidden]) .music-service-view-tabs button').all()) {
        await button.click(); await page.waitForTimeout(400); await page.waitForLoadState('networkidle', { timeout: 45000 });
        const group = await button.getAttribute('data-service-group'); assert.equal(await button.getAttribute('aria-pressed'), 'true'); const visible = page.locator('.dashboard-view:not([hidden]) .music-service-group:not([hidden])'); assert.equal(await visible.count(), 1); assert.equal(await visible.getAttribute('data-group'), group); await page.screenshot({ path: `${output}/${mode}-${group}-${viewportLabel}.png`, fullPage: true }); downloads.push(...await checkCsv(page, `${mode}-${group}-${viewportLabel}`));
      }
      for (const button of await page.locator('.dashboard-view:not([hidden]) [data-stationhead-section]:not(:disabled)').all()) {
        await button.click(); await page.waitForTimeout(400); await page.waitForLoadState('networkidle', { timeout: 45000 }); const section = await button.getAttribute('data-stationhead-section'); await page.screenshot({ path: `${output}/${mode}-${section}-${viewportLabel}.png`, fullPage: true }); downloads.push(...await checkCsv(page, `${mode}-${section}-${viewportLabel}`));
      }
      results.push({ mode, viewport: viewportLabel, overflow, downloads });
    }
    for (const account of ['sakurazaka46jp', 'nogizaka46smej']) {
      await page.goto(`${origin}/${account}/`); await page.waitForLoadState('networkidle', { timeout: 45000 }); await assertNoDocumentOverflow(page, `${account}-${viewportLabel}`); await page.screenshot({ path: `${output}/${account}-${viewportLabel}.png`, fullPage: true }); results.push({ account, viewport: viewportLabel });
    }
    await page.close();
  }
  await writeFile(`${output}/results.json`, JSON.stringify({ source: live ? 'production API snapshots with PR assets' : 'stress + empty fixture', capturedAt: new Date().toISOString(), results, apiResults, runtimeErrors }, null, 2));
  assert.deepEqual(runtimeErrors, [], 'browser runtime exceptions');
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ source: live ? 'production API snapshots with PR assets' : 'stress + empty fixture', capturedAt: new Date().toISOString(), results, apiResults, runtimeErrors }, null, 2));
  await browser.close(); await new Promise((resolveServer) => server.close(resolveServer));
}
