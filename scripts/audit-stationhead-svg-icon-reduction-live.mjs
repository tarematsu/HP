import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const option = (name, fallback = '') => {
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] && !process.argv[at + 1].startsWith('--')
    ? process.argv[at + 1]
    : fallback;
};

const startPattern = /start\s+listening|listen\s+(?:now|live)|join\s+(?:station|room)|resume|continue|再生|聴く|参加/i;
const svgIconPattern = /\/assets\/svgiconnonlazy-[a-z0-9_-]{6,}\.m?js(?:[?#]|$)/i;
const premiumIconPattern = /\/assets\/premium-20-[a-z0-9_-]{6,}\.m?js(?:[?#]|$)/i;
const svgIconStub = 'export const SVGIconNonLazy=()=>null;';

async function labelOf(locator) {
  return locator.evaluate((node) => [
    node.textContent || '',
    node.getAttribute('aria-label') || '',
    node.getAttribute('title') || '',
    node.getAttribute('value') || '',
  ].join(' ').replace(/\s+/g, ' ').trim()).catch(() => '');
}

async function findStartListening(page, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const controls = page.locator('button,[role="button"],a,input[type="button"],input[type="submit"]');
    const count = Math.min(await controls.count(), 300);
    for (let index = 0; index < count; index += 1) {
      const control = controls.nth(index);
      if (!await control.isVisible().catch(() => false)) continue;
      const label = await labelOf(control);
      if (startPattern.test(label)) return { control, label };
    }
    if (Date.now() >= deadline) return null;
    await page.waitForTimeout(250);
  } while (true);
}

async function visiblePageState(page) {
  return page.evaluate(() => {
    const body = document.body;
    const rect = body?.getBoundingClientRect?.();
    const text = (body?.innerText || '').replace(/\s+/g, ' ').trim();
    return {
      title: document.title,
      url: location.href,
      bodyTextLength: text.length,
      bodyPreview: text.slice(0, 500),
      bodyVisible: Boolean(rect && rect.width > 2 && rect.height > 2),
      backgroundColor: body ? getComputedStyle(body).backgroundColor : '',
    };
  }).catch(() => ({
    title: '', url: '', bodyTextLength: 0, bodyPreview: '', bodyVisible: false, backgroundColor: '',
  }));
}

async function main() {
  const targetUrl = option('--url', 'https://www.stationhead.com/sakuramankai');
  const outPath = option('--out', '.sh-js-audit/svg-icon-reduction.json');
  const outputDirectory = path.dirname(path.resolve(outPath));
  await mkdir(outputDirectory, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1365, height: 900 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    serviceWorkers: 'allow',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  const requestedScripts = [];
  const pageErrors = [];
  let svgIconIntercepted = 0;
  let premiumIconRequested = 0;

  page.on('request', (request) => {
    const url = request.url();
    if (request.resourceType() === 'script') requestedScripts.push(url);
    if (premiumIconPattern.test(url)) premiumIconRequested += 1;
  });
  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error).slice(0, 1000)));

  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (svgIconPattern.test(url)) {
      svgIconIntercepted += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        headers: { 'cache-control': 'public, max-age=31536000, immutable' },
        body: svgIconStub,
      });
      return;
    }
    await route.continue();
  });

  const navigationStartedAt = Date.now();
  let navigationError = '';
  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  } catch (error) {
    navigationError = String(error?.message || error);
  }

  const candidate = await findStartListening(page);
  const visibleAfterMs = candidate ? Date.now() - navigationStartedAt : null;
  const before = await visiblePageState(page);
  const clicked = candidate
    ? await candidate.control.click({ timeout: 5000 }).then(() => true).catch(() => false)
    : false;
  if (clicked) await page.waitForTimeout(5000);
  const after = await visiblePageState(page);

  const result = {
    targetUrl,
    navigationError,
    svgIconIntercepted,
    premiumIconRequested,
    startListeningVisible: Boolean(candidate),
    startListeningLabel: candidate?.label || '',
    startListeningVisibleAfterMs: visibleAfterMs,
    clicked,
    afterClickScreenVisible: after.bodyVisible && after.bodyTextLength > 0,
    before,
    after,
    pageErrors,
    requestedScriptCount: requestedScripts.length,
    requestedScripts: [...new Set(requestedScripts)],
  };
  result.passed = !navigationError &&
    result.svgIconIntercepted > 0 &&
    result.premiumIconRequested === 0 &&
    result.startListeningVisible &&
    result.clicked &&
    result.afterClickScreenVisible &&
    result.pageErrors.length === 0;

  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  await context.close();
  await browser.close();
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
