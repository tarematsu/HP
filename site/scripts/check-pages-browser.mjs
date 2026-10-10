// Browser regression for route ownership, responsive layouts, live data and downloads.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { NAVIGATION, navigationForMode } from '../public/dashboard-navigation-config.js';

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
const modes = NAVIGATION.flatMap(section => section.sources.flatMap(source => source.functions.map(item => item.mode)));
const stationheadFunctions = NAVIGATION[0].sources[0].functions.map(item => item.label);

function emptyFixture() {
  return {
    ok: true,
    rows: [], history: [], dates: [], artists: [], tracks: [], ranking: [], series: [], items: [], latest: {},
    queue: [{ is_current: true, title: '非常に長い曲名を使ったレイアウト回帰テスト用トラックタイトル', artist: 'テストアーティスト', thumbnail_url: '/missing-artwork.jpg', duration_ms: 240000 }],
    queue_status: { current_index: 0, returned_items: 1, total_items: 1, playing: false },
  };
}

async function fetchLiveApiSnapshot(path) {
  const target = `https://skrzk.pages.dev${path}`;
  const response = await fetch(target, { signal: AbortSignal.timeout(30000) });
  let status = response.status;
  let body = await response.text();
  let payload;
  try { payload = JSON.parse(body); } catch {}

  const requested = new URL(target);
  const isPreDeployOhisamaLikes = status === 400
    && requested.pathname === '/api/track-history'
    && requested.searchParams.get('source') === 'ohisama'
    && requested.searchParams.get('ranking_only') === '1'
    && String(payload?.error || '').includes('unsupported track-history parameter: source');

  let compatibility = null;
  let upstreamStatus = null;
  if (isPreDeployOhisamaLikes) {
    const legacyResponse = await fetch('https://skrzk.pages.dev/api/hinata', {
      signal: AbortSignal.timeout(30000),
    });
    const legacyBody = await legacyResponse.text();
    let legacyPayload;
    try { legacyPayload = JSON.parse(legacyBody); } catch {}
    if (legacyResponse.ok && legacyPayload?.ok) {
      const ranking = Array.isArray(legacyPayload.likes)
        ? legacyPayload.likes
        : Object.values(legacyPayload.likes || {});
      upstreamStatus = status;
      compatibility = 'pre-source-ohisama-likes';
      payload = {
        ok: true,
        mode: 'likes',
        source: 'ohisama',
        ranking,
        ranking_summary: { track_count: ranking.length },
      };
      body = JSON.stringify(payload);
      status = 200;
    }
  }

  apiResults.push({
    path,
    status,
    upstreamStatus,
    compatibility,
    capturedAt: new Date().toISOString(),
    bytes: Buffer.byteLength(body),
    ok: payload?.ok,
    rows: Array.isArray(payload?.rows) ? payload.rows.length : undefined,
    ranking: Array.isArray(payload?.ranking) ? payload.ranking.length : undefined,
  });
  return { status, contentType: 'application/json', body };
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
    if (live) assert.ok(csv.trim().split(/\r?\n/).length > 1, `${label}: ${download.suggestedFilename()} CSV contains only headers`);
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
  const hiddenSelectedDates = await page.locator('.dashboard-view:not([hidden]) .played-tracks-period-scroller:visible').evaluateAll((scrollers) => scrollers.filter((scroller) => {
    const selected = scroller.querySelector('.is-selected');
    if (!selected) return false;
    const item = selected.getBoundingClientRect(); const bounds = scroller.getBoundingClientRect();
    return item.left < bounds.left - 2 || item.right > bounds.right + 2;
  }).length);
  assert.equal(hiddenSelectedDates, 0, `${label} hides the selected playback date`);
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
      if (!snapshots.has(path)) snapshots.set(path, fetchLiveApiSnapshot(path));
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
      if (navigationForMode(mode).section.id === 'stationhead') {
        assert.deepEqual(sourceLabels, ['Buddies', 'Ohisama', 'Nogizaka', 'リーダーボード', 'フォロワー'], `${mode}: Stationhead targets only`);
      } else {
        assert.deepEqual(sourceLabels, ['Spotify', 'Apple Music', 'Amazon Music', 'YouTube Music', '🇹🇼KKBOX', '🇨🇳QQ音乐', '🇨🇳酷狗音乐'], `${mode}: streaming services only`);
      }
      if (navigationForMode(mode).source.id === 'buddies') {
        assert.deepEqual(await page.locator('#functionTabs button').allTextContents(), stationheadFunctions, `${mode}: Buddies functions`);
      }
      if (navigationForMode(mode).source.id === 'hinata') {
        assert.deepEqual(await page.locator('#functionTabs button').allTextContents(),
          NAVIGATION[0].sources[1].functions.map(item => item.label), `${mode}: Ohisama shares the channel functions`);
      }
      if (['ranking', 'followers'].includes(mode)) {
        assert.deepEqual(await page.locator('#functionTabs button').allTextContents(), [], `${mode}: standalone source`);
        assert.equal(await page.locator('#sourceSelect').inputValue(), mode);
      }
      if (!live && mode === 'current') {
        await page.waitForTimeout(100);
        assert.equal(await page.locator('[data-role="track-image"]').isHidden(), true, 'broken artwork stays hidden');
        assert.equal(await page.locator('.track-fallback').isVisible(), true, 'broken artwork keeps fallback visible');
      }
      if (live && ['past', 'hinata-past'].includes(mode)) {
        // Network idle can precede JSON parsing, the daily overlay and table rendering.
        // Wait for the selected route's data, while retaining the non-empty assertion.
        try {
          await page.waitForFunction((expectedMode) => {
            const view = document.getElementById(expectedMode === 'past' ? 'currentView' : 'hinataView');
            const cell = view?.querySelector('[data-role="daily-tbody"] tr td');
            return location.hash === `#${expectedMode}` && view && !view.hidden
              && /^\d{4}/.test(cell?.textContent || '');
          }, mode, { timeout: 30000 });
        } catch (error) {
          await page.screenshot({ path: `${output}/history-not-ready-${label}.png`, fullPage: true });
          throw new Error(`${mode}: history data did not load; API results: ${JSON.stringify(apiResults)}`, { cause: error });
        }
        assert.match(await page.locator('.dashboard-view:not([hidden]) [data-role="daily-tbody"] tr td').first().textContent(), /^\d{4}/, `${mode}: history data did not load`);
      }
      if (!live && width === 320 && ['broadcasts', 'ranking', 'youtube-music', 'kkbox'].includes(mode)) await stressVisibleLayout(page, label);
      await page.screenshot({ path: `${output}/${label}.png`, fullPage: true });
      const downloads = await checkCsv(page, label);
      for (const button of await page.locator('.dashboard-view:not([hidden]) .music-service-view-tabs button').all()) {
        await button.click(); await page.waitForTimeout(400); await page.waitForLoadState('networkidle', { timeout: 45000 });
        const group = await button.getAttribute('data-service-group'); assert.equal(await button.getAttribute('aria-pressed'), 'true'); const visible = page.locator('.dashboard-view:not([hidden]) .music-service-group:not([hidden])'); assert.equal(await visible.count(), 1); assert.equal(await visible.getAttribute('data-group'), group);
        if (!live && mode === 'youtube-music' && group === 'playlists') {
          const overflow = await page.locator('#youtubeMusicPlaylistBody').evaluate((body) => {
            const row = document.createElement('tr');
            for (const value of ['Top songs', 'official', '30']) {
              const cell = document.createElement('td');
              cell.textContent = value;
              row.append(cell);
            }
            body.replaceChildren(row);
            const wrap = body.closest('.table-wrap');
            return Math.max(0, (wrap?.scrollWidth || 0) - (wrap?.clientWidth || 0));
          });
          if (width <= 760) assert.equal(overflow, 0, `${mode}: mobile playlist columns must not be clipped`);
        }
        await page.screenshot({ path: `${output}/${mode}-${group}-${viewportLabel}.png`, fullPage: true }); downloads.push(...await checkCsv(page, `${mode}-${group}-${viewportLabel}`));
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

