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
      if (!live) {
        const fixture = emptyFixture();
        if (url.pathname === '/api/spotify-charts') {
          const date = new Date().toISOString().slice(0, 10);
          const year = date.slice(0, 4);
          if (url.searchParams.has('chart')) {
            Object.assign(fixture, { periods: [{ chart_date: date, status: 'ok', entries: [
              { id: 'chart-fixture', title: 'Fixture Track', rank: 12, artists: ['sakurazaka46'], streams: 12345 },
            ] }] });
          } else {
            Object.assign(fixture, { charts: ['artist', 'regional', 'album', 'viral'].flatMap(type =>
              (type === 'album' ? ['weekly'] : ['daily', 'weekly']).map(period => ({
                chart_id: `${type}-jp-${period}`, status: 'ok', years: [year], latest_chart_date: date,
                observed_at: Date.now(), history_complete: true,
              }))) });
          }
        }
        if (url.pathname === '/api/kkbox') {
          // Test a real, renderable KKBOX read model rather than the generic
          // fixture (which lacks "service" and exercises only error fallback).
          const period = new Date().toISOString().slice(0, 10);
          const history = ['tw', 'hk'].flatMap((territory) => ['newrelease', 'song'].flatMap((chart_type) =>
            ['daily', 'weekly'].map((period_type) => ({
              territory, chart_type, period_type, period, rank: 5,
              canonical_artists: ['sakurazaka46'], title: 'Fixture Track',
            }))));
          Object.assign(fixture, {
            service: 'kkbox',
            updated_at: Date.now(),
            kkbox_japanese_chart: {
              periods: history.map(({ territory, chart_type, period_type, period }) =>
                ({ territory, chart_type, period_type, period, status: 'ok' })),
              history,
            },
          });
          // Exercise the asynchronous route/read-model transition in CI.
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 900));
        }
        if (url.pathname === '/api/history' && url.searchParams.get('mode') === 'ranking') {
          Object.assign(fixture, {
            source_max_ranking_date: '2026-10-12',
            materialized_at: Date.now(),
            chart_hosts: ['sakuramankai', 'sakurazaka46jp', 'nogizaka46smej'],
            rows: [
              { ranking_date: '2026-10-05', rank: 41, host_name: 'nogizaka46smej',
                stationhead_channel_name: '乃木坂46公式', artist_name: '乃木坂46', fandom_type: 'official' },
              { ranking_date: '2026-09-28', rank: 7, host_name: 'sakurazaka46jp',
                stationhead_channel_name: '櫻坂46公式', artist_name: '櫻坂46', fandom_type: 'official' },
              { ranking_date: '2026-10-12', rank: null, host_name: 'nogizaka46smej',
                stationhead_channel_name: '乃木坂46公式', artist_name: '乃木坂46', fandom_type: 'official',
                synthetic: true, is_out_of_rank: true },
            ],
          });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) });
      }
      if (!snapshots.has(path)) snapshots.set(path, fetchLiveApiSnapshot(path));
      try { await route.fulfill(await snapshots.get(path)); }
      catch (error) { apiResults.push({ path, error: error.message }); await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'snapshot unavailable' }) }); }
    });
    await page.goto(origin);
    for (const mode of modes) {
      await page.evaluate((nextMode) => { location.hash = nextMode; }, mode);
      await page.waitForFunction(() => [...document.querySelectorAll('.dashboard-view')].some((node) => !node.hidden), { timeout: 10000 });
      await page.waitForTimeout(500);
      // Live dashboards deliberately poll. Network-idle is not a valid readiness
      // signal there; assert the selected view and its route-specific data below.
      if (live) {
        await page.waitForFunction((viewId) => {
          const view = document.getElementById(viewId);
          return Boolean(view && !view.hidden);
        }, navigationForMode(mode).route.viewId, { timeout: 15000 });
      } else await page.waitForLoadState('networkidle', { timeout: 45000 });
      const label = `${mode}-${viewportLabel}`;
      const overflow = await assertNoDocumentOverflow(page, label);
      assert.equal(await page.locator('main').count(), 1);
      assert.equal(await page.locator('#sourceTabs').isVisible(), width > 760, `${mode}: selector breakpoint`);
      assert.equal(await page.locator('#sourceSelect').isVisible(), width <= 760, `${mode}: native selector breakpoint`);

      const sourceLabels = width > 760 ? await page.locator('#sourceTabs button').allTextContents() : await page.locator('#sourceSelect option').allTextContents();
      if (navigationForMode(mode).section.id === 'stationhead') {
        assert.deepEqual(sourceLabels, ['Buddies', 'Ohisama', 'Nogizaka', 'リーダーボード', 'フォロワー'], `${mode}: Stationhead targets only`);
      } else {
        assert.deepEqual(sourceLabels, ['Spotify 再生数', 'Spotify チャート', 'Apple Music', 'Amazon Music', 'YouTube Music', '🇹🇼KKBOX', '🇨🇳QQ音乐', '🇨🇳酷狗音乐'], `${mode}: streaming services only`);
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
      if (!live && mode === 'ranking' && width <= 390) {
        const card = page.locator('#leaderboardMobileList > .dashboard-responsive-card').first();
        assert.equal(await card.locator('.dashboard-responsive-field').count(), 6, 'each ranking card exposes all six fields');
        assert.equal(await card.evaluate((node) => getComputedStyle(node).display), 'grid', 'phone uses leaderboard cards');
        assert.equal(await card.locator('[data-key="host"]').count(), 1, 'host is visible in each card');
        const hiddenFields = await card.locator('.dashboard-responsive-field').evaluateAll((fields) => fields
          .map((field) => ({ label: field.dataset.key, bounds: field.getBoundingClientRect() }))
          .filter(({ bounds }) => bounds.left < -2 || bounds.right > innerWidth + 2)
          .map(({ label }) => label));
        assert.deepEqual(hiddenFields, [], 'every leaderboard field fits the phone viewport');
        assert.equal(await page.locator('.leaderboard-view .dashboard-responsive-table').isVisible(), false,
          'desktop leaderboard table is hidden on phones');
      }
      if (!live && mode === 'followers' && width <= 390) {
        const card = page.locator('#followersMobileList > .dashboard-responsive-card').first();
        assert.equal(await card.locator('.dashboard-responsive-field').count(), 5,
          'followers use the same shared responsive card renderer');
        const clipped = await card.locator('.dashboard-responsive-field').evaluateAll((nodes) => nodes
          .filter((node) => node.getBoundingClientRect().right > innerWidth + 2)
          .map((node) => node.dataset.key));
        assert.deepEqual(clipped, [], 'follower cards stay within the viewport');
      }
      if (mode === 'spotify') {
        assert.deepEqual(await page.locator('#spotifyView .music-service-view-tabs button').allTextContents(),
          ['総再生数', '今年リリース曲再生数']);
        const tableBounds = await page.locator('#spotifyTrackSection table').evaluate(table => {
          const wrap = table.closest('.table-wrap');
          const bounds = wrap.getBoundingClientRect();
          return [...table.querySelectorAll('thead th')].map(cell => {
            const cellBounds = cell.getBoundingClientRect();
            return { label: cell.textContent, fits: cellBounds.left >= bounds.left - 2 && cellBounds.right <= bounds.right + 2 };
          });
        });
        assert.equal(tableBounds.length, 4);
        assert.ok(tableBounds.every(cell => cell.fits), `${label}: all playcount columns fit without horizontal scrolling`);
        for (const group of ['plays', 'year']) {
          const panel = page.locator(`#spotifyView .music-service-group[data-group="${group}"]`);
          assert.equal(await panel.locator('[data-service-group]').count(), 2, `${group}: graph and list share one panel`);
        }
      }
      if (mode === 'spotify-charts') {
        assert.deepEqual(await page.locator('#spotifyChartsView .music-service-view-tabs button').allTextContents(),
          ['月間リスナー', 'トップアーティスト', 'トップソング', 'トップアルバム', 'バイラル']);
        for (const group of ['listeners', 'artist', 'regional', 'album', 'viral']) {
          const panel = page.locator(`#spotifyChartsView .music-service-group[data-group="${group}"]`);
          assert.equal(await panel.locator('[data-service-group]').count(), 2, `${group}: graph and list share one panel`);
        }
        assert.deepEqual(await page.locator('[data-spotify-chart-artist]').allTextContents(),
          ['すべて', '櫻坂', '乃木坂', '日向坂', '坂道選抜']);
      }
      if (mode === 'kkbox') {
        // A visible lazy shell does not mean its asynchronous data render has
        // finished. Network-idle can also precede a newly scheduled API read.
        try {
          await page.waitForFunction(() => {
            const view = document.getElementById('kkboxView');
            const chart = document.getElementById('kkboxJapaneseRankChart');
            return location.hash === '#kkbox' && view && !view.hidden
              && Boolean(chart?.querySelector('canvas, .music-service-rank-empty'));
          }, null, { timeout: 30000 });
        } catch (error) {
          await page.screenshot({ path: `${output}/kkbox-not-ready-${label}.png`, fullPage: true });
          const ui = await page.evaluate(() => ({
            notice: document.getElementById('kkboxNotice')?.textContent,
            routeError: document.getElementById('routeError')?.textContent,
            chartText: document.getElementById('kkboxJapaneseRankChart')?.textContent,
          }));
          throw new Error(`${label}: KKBOX render did not complete: ${JSON.stringify({
            ui, api: apiResults.filter((entry) => entry.path.startsWith('/api/kkbox')),
            runtimeErrors,
          })}`, { cause: error });
        }
        const categories = page.locator('#kkboxView [data-kkbox-series-filter]');
        assert.deepEqual(await categories.allTextContents(), ['台湾新曲', '香港新曲', '台湾楽曲', '香港楽曲']);
        for (const category of await categories.all()) {
          await category.click();
          assert.equal(await category.getAttribute('aria-pressed'), 'true');
          for (const period of await page.locator('#kkboxView [data-kkbox-period-filter]').all()) {
            await period.click();
            assert.equal(await period.getAttribute('aria-pressed'), 'true');
            assert.equal(await page.locator('#kkboxJapaneseRankChart').isVisible(), true);
            assert.equal(await page.locator('#kkboxJapaneseHistoryBody').isVisible(), true);
            if (!live) assert.equal(await page.locator('#kkboxJapaneseRankChart canvas').count(), 1,
              `${label}: fixture must draw a real KKBOX chart for every category and period`);
            await assertNoDocumentOverflow(page, `${label}-kkbox-switch`);
          }
        }
      }
      await page.screenshot({ path: `${output}/${label}.png`, fullPage: true });
      if (!live && width === 320 && ['broadcasts', 'ranking', 'youtube-music', 'kkbox'].includes(mode)) await stressVisibleLayout(page, label);
      const downloads = await checkCsv(page, label);
      for (const button of await page.locator('.dashboard-view:not([hidden]) .music-service-view-tabs button[data-service-group]').all()) {
        await button.click(); await page.waitForTimeout(live ? 700 : 400); if (!live) await page.waitForLoadState('networkidle', { timeout: 45000 });
        const group = await button.getAttribute('data-service-group'); assert.equal(await button.getAttribute('aria-pressed'), 'true'); const visible = page.locator('.dashboard-view:not([hidden]) .music-service-group:not([hidden])'); assert.equal(await visible.count(), 1); assert.equal(await visible.getAttribute('data-group'), group);
        if (!live && mode === 'spotify-charts' && group === 'regional' && width <= 390) {
          const card = page.locator('#spotifyChartCards-regional .dashboard-responsive-card').first();
          assert.equal(await card.locator('.dashboard-responsive-field').count(), 5,
            'Spotify Top Songs exposes date, group, rank, title and streams');
          assert.equal(await page.locator('#spotifyChartsView .spotify-chart-history-table').isVisible(), false,
            'mobile ranks use shared cards instead of a clipped table');
          const fields = await card.locator('.dashboard-responsive-field').evaluateAll(nodes =>
            nodes.map(node => ({ key: node.dataset.key, text: node.textContent,
              bounds: node.getBoundingClientRect().toJSON() })));
          assert.deepEqual(fields.map(field => field.key), ['date', 'artist', 'rank', 'title', 'streams']);
          assert.ok(fields.every(field => field.bounds.width > 0
            && field.bounds.left >= -2 && field.bounds.right <= width + 2
            && field.text.trim()), `Spotify chart card has missing/clipped fields: ${JSON.stringify(fields)}`);
        }
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
      await page.goto(`${origin}/${account}/`); if (!live) await page.waitForLoadState('networkidle', { timeout: 45000 }); await assertNoDocumentOverflow(page, `${account}-${viewportLabel}`); await page.screenshot({ path: `${output}/${account}-${viewportLabel}.png`, fullPage: true }); results.push({ account, viewport: viewportLabel });
    }
    await page.close();
  }
  await writeFile(`${output}/results.json`, JSON.stringify({ source: live ? 'production API snapshots with PR assets' : 'stress + empty fixture', capturedAt: new Date().toISOString(), results, apiResults, runtimeErrors }, null, 2));
  assert.deepEqual(runtimeErrors, [], 'browser runtime exceptions');
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ source: live ? 'production API snapshots with PR assets' : 'stress + empty fixture', capturedAt: new Date().toISOString(), results, apiResults, runtimeErrors }, null, 2));
  await browser.close(); await new Promise((resolveServer) => server.close(resolveServer));
}

