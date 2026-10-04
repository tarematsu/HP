// Offline browser regression: shells, navigation, and empty/error states.
// Production data, populated charts, and CSV downloads need a separate visual review.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('site/public');
const output = resolve('site/artifacts/browser');
await mkdir(output, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(`${root}/`)) throw new Error('outside root');
    res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 960 } });
    await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, rows: [], history: [], dates: [], artists: [], tracks: [], ranking: [], series: [], items: [], latest: {}, queue: [] }) }));
    await page.goto(origin);
    for (const mode of ['current', 'daily', 'weekly', 'monthly', 'played-tracks', 'likes', 'broadcasts', 'hinata', 'nogizaka', 'spotify', 'apple-music', 'amazon-music', 'youtube-music', 'kkbox', 'qq_music', 'kugou_music', 'ranking', 'followers', 'music-ranking', 'music-followers']) {
      await page.evaluate(mode => { location.hash = mode; }, mode);
      await page.waitForFunction(() => [...document.querySelectorAll('.dashboard-view')].some(node => !node.hidden), { timeout: 10000 });
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
      assert.equal(overflow, false, `${mode} at ${width}px overflows the document`);
      assert.equal(await page.locator('main').count(), 1);
      assert.equal(await page.locator('#sourceTabs').isVisible(), width > 760, `${mode}: selector breakpoint`);
      assert.equal(await page.locator('#sourceSelect').isVisible(), width <= 760, `${mode}: native selector breakpoint`);
      for (const button of await page.locator('.dashboard-view:not([hidden]) .music-service-view-tabs button').all()) {
        await button.click();
        const group = await button.getAttribute('data-service-group');
        assert.equal(await button.getAttribute('aria-pressed'), 'true');
        const visible = page.locator('.dashboard-view:not([hidden]) .music-service-group:not([hidden])');
        assert.equal(await visible.count(), 1);
        assert.equal(await visible.getAttribute('data-group'), group);
        await page.screenshot({ path: `${output}/${mode}-${group}-${width}.png`, fullPage: true });
      }
      await page.screenshot({ path: `${output}/${mode}-${width}.png`, fullPage: true });
      results.push({ mode, width, overflow });
    }
    await page.close();
  }
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
