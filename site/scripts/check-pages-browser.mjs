// Offline browser regression: shells, navigation, and empty/error states.
// Production data, populated charts, and CSV downloads need a separate visual review.
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
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const results = [];
const runtimeErrors = [];
async function checkCsv(page, label) {
  const downloads = [];
  for (const button of await page.locator('.dashboard-view:not([hidden]) .csv-button:visible:not(:disabled)').all()) {
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
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 960 } });
    page.on('pageerror', error => runtimeErrors.push({ width, message: error.message, url: page.url() }));
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname + new URL(route.request().url()).search;
      if (!live) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, rows: [], history: [], dates: [], artists: [], tracks: [], ranking: [], series: [], items: [], latest: {}, queue: [] }) });
      if (!snapshots.has(path)) snapshots.set(path, (async () => {
        const response = await fetch(`https://skrzk.pages.dev${path}`, { signal: AbortSignal.timeout(30000) });
        const body = await response.text();
        apiResults.push({ path, status: response.status, capturedAt: new Date().toISOString(), bytes: Buffer.byteLength(body) });
        return { status: response.status, contentType: 'application/json', body };
      })());
      try { await route.fulfill(await snapshots.get(path)); }
      catch (error) { apiResults.push({ path, error: error.message }); await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'snapshot unavailable' }) }); }
    });
    await page.goto(origin);
    for (const mode of ['current', 'daily', 'weekly', 'monthly', 'played-tracks', 'likes', 'broadcasts', 'hinata', 'nogizaka', 'spotify', 'apple-music', 'amazon-music', 'youtube-music', 'kkbox', 'qq_music', 'kugou_music', 'ranking', 'followers', 'music-ranking', 'music-followers']) {
      await page.evaluate(mode => { location.hash = mode; }, mode);
      await page.waitForFunction(() => [...document.querySelectorAll('.dashboard-view')].some(node => !node.hidden), { timeout: 10000 });
      await page.waitForTimeout(800);
      await page.waitForLoadState('networkidle', { timeout: 45000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
      if (overflow) {
        await page.screenshot({ path: `${output}/overflow-${mode}-${width}.png`, fullPage: true });
        const elements = await page.evaluate(() => [...document.querySelectorAll('body *')].map(node => ({ tag: node.tagName, id: node.id, className: String(node.className), right: node.getBoundingClientRect().right })).filter(node => node.right > innerWidth + 2));
        await writeFile(`${output}/overflow-${mode}-${width}.json`, JSON.stringify(elements, null, 2));
      }
      assert.equal(overflow, false, `${mode} at ${width}px overflows the document`);
      assert.equal(await page.locator('main').count(), 1);
      assert.equal(await page.locator('#sourceTabs').isVisible(), width > 760, `${mode}: selector breakpoint`);
      assert.equal(await page.locator('#sourceSelect').isVisible(), width <= 760, `${mode}: native selector breakpoint`);
      if (live && ['daily', 'weekly', 'monthly'].includes(mode)) {
        assert.match(await page.locator('#tbody tr td').first().textContent(), /^\d{4}/, `${mode}: history data did not load`);
      }
      await page.screenshot({ path: `${output}/${mode}-${width}.png`, fullPage: true });
      const downloads = await checkCsv(page, `${mode}-${width}`);
      for (const button of await page.locator('.dashboard-view:not([hidden]) .music-service-view-tabs button').all()) {
        await button.click();
        await page.waitForTimeout(800);
        await page.waitForLoadState('networkidle', { timeout: 45000 });
        const group = await button.getAttribute('data-service-group');
        assert.equal(await button.getAttribute('aria-pressed'), 'true');
        const visible = page.locator('.dashboard-view:not([hidden]) .music-service-group:not([hidden])');
        assert.equal(await visible.count(), 1);
        assert.equal(await visible.getAttribute('data-group'), group);
        await page.screenshot({ path: `${output}/${mode}-${group}-${width}.png`, fullPage: true });
        downloads.push(...await checkCsv(page, `${mode}-${group}-${width}`));
      }
      for (const button of await page.locator('.dashboard-view:not([hidden]) [data-stationhead-section]:not(:disabled)').all()) {
        await button.click();
        await page.waitForTimeout(800);
        await page.waitForLoadState('networkidle', { timeout: 45000 });
        const section = await button.getAttribute('data-stationhead-section');
        await page.screenshot({ path: `${output}/${mode}-${section}-${width}.png`, fullPage: true });
        downloads.push(...await checkCsv(page, `${mode}-${section}-${width}`));
      }
      results.push({ mode, width, overflow, downloads });
    }
    for (const account of ['sakurazaka46jp', 'nogizaka46smej']) {
      await page.goto(`${origin}/${account}/`);
      await page.waitForLoadState('networkidle', { timeout: 45000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, `${account}: page overflow`);
      await page.screenshot({ path: `${output}/${account}-${width}.png`, fullPage: true });
      results.push({ account, width });
    }
    await page.close();
  }
  await writeFile(`${output}/results.json`, JSON.stringify({ source: live ? 'production API snapshots with PR assets' : 'empty fixture', capturedAt: new Date().toISOString(), results, apiResults, runtimeErrors }, null, 2));
  assert.deepEqual(runtimeErrors, [], 'browser runtime exceptions');
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ source: live ? 'production API snapshots with PR assets' : 'empty fixture', capturedAt: new Date().toISOString(), results, apiResults, runtimeErrors }, null, 2));
  await browser.close(); await new Promise(resolve => server.close(resolve)); }
