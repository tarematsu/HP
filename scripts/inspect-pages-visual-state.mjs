import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const outDir = '.pages-visual-diagnostic';
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  colorScheme: 'light',
  locale: 'ja-JP',
  serviceWorkers: 'block',
});
const page = await context.newPage();
const records = [];

for (const path of ['/', '/#daily', '/#weekly']) {
  await page.goto(`https://skrzk.pages.dev${path}`, { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const state = await page.evaluate(async () => {
    const skip = document.querySelector('.skip-link');
    const rect = skip?.getBoundingClientRect();
    const style = skip ? getComputedStyle(skip) : null;
    let dashboard = null;
    try {
      const response = await fetch('/api/dashboard?history=0', {
        headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      });
      dashboard = await response.json();
    } catch (error) {
      dashboard = { error: String(error) };
    }
    return {
      url: location.href,
      activeElement: document.activeElement?.outerHTML?.slice(0, 500) || null,
      htmlClass: document.documentElement.className,
      skip: skip ? {
        focused: document.activeElement === skip,
        focusVisible: skip.matches(':focus-visible'),
        rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
        display: style?.display,
        visibility: style?.visibility,
        opacity: style?.opacity,
        transform: style?.transform,
        pointerEvents: style?.pointerEvents,
      } : null,
      stylesheets: [...document.styleSheets].map((sheet) => sheet.href).filter(Boolean),
      dashboard: dashboard ? {
        generated_at: dashboard.generated_at,
        queue_status: dashboard.queue_status,
        queue: Array.isArray(dashboard.queue) ? dashboard.queue.slice(0, 8) : dashboard.queue,
      } : null,
    };
  });
  records.push(state);
}

const trackUrl = 'https://open.spotify.com/track/0excsYy4LOVEcQTN4OPeJE';
let spotifyOembed = null;
try {
  const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(trackUrl)}`, {
    headers: { accept: 'application/json', 'user-agent': 'HomePanel-visual-diagnostic/1.0' },
    signal: AbortSignal.timeout(10_000),
  });
  spotifyOembed = {
    status: response.status,
    ok: response.ok,
    payload: await response.json().catch(() => null),
  };
} catch (error) {
  spotifyOembed = { error: String(error) };
}

await writeFile(`${outDir}/report.json`, `${JSON.stringify(records, null, 2)}\n`);
await writeFile(`${outDir}/spotify-oembed.json`, `${JSON.stringify(spotifyOembed, null, 2)}\n`);
console.log(JSON.stringify({ records, spotifyOembed }, null, 2));
await context.close();
await browser.close();
