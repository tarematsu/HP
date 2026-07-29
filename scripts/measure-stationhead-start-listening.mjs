import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const option = (name, fallback = '') => {
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] && !process.argv[at + 1].startsWith('--')
    ? process.argv[at + 1]
    : fallback;
};

const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const startPattern = /\b(start|join|resume|continue)\s+(listening|station|show|room)\b|\blisten\s+(now|live)\b|^(continue|続ける|続行|次へ)$/i;

async function candidateLabel(locator) {
  return locator.evaluate((node) => [
    node.innerText,
    node.getAttribute?.('aria-label'),
    node.textContent,
    node.getAttribute?.('title'),
    node.getAttribute?.('value'),
    node.getAttribute?.('data-testid'),
  ].map((value) => String(value || '').replace(/\s+/g, ' ').trim()).find(Boolean) || '').catch(() => '');
}

async function findStartListening(page, timeoutMs) {
  const startedAt = performance.now();
  const deadline = startedAt + timeoutMs;
  while (performance.now() < deadline) {
    try {
      const candidates = page.locator("button,[role='button'],a,input[type='button'],input[type='submit'],[aria-label],[data-testid],[tabindex]");
      const count = Math.min(await candidates.count(), 400);
      for (let index = 0; index < count; index += 1) {
        const candidate = candidates.nth(index);
        if (!await candidate.isVisible().catch(() => false)) continue;
        const label = normalize(await candidateLabel(candidate));
        if (startPattern.test(label)) {
          return { candidate, label, observedAfterMs: Math.round(performance.now() - startedAt) };
        }
      }
    } catch {
      // Navigation can replace the execution context while the polling loop is active.
    }
    await page.waitForTimeout(100);
  }
  return null;
}

async function measure(browser, url, attempt) {
  const context = await browser.newContext({
    viewport: { width: 1365, height: 900 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36',
    serviceWorkers: 'allow',
  });
  const page = await context.newPage();
  const navigationStartedAt = performance.now();
  const visiblePromise = findStartListening(page, 30_000);
  let navigationError = '';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    .catch((error) => { navigationError = String(error?.message || error); });
  const domContentLoadedAfterMs = Math.round(performance.now() - navigationStartedAt);
  const visible = await visiblePromise;
  const visibleAfterNavigationMs = visible
    ? Math.round(performance.now() - navigationStartedAt)
    : null;
  let clicked = false;
  let disappearedAfterClickMs = null;
  if (visible) {
    const clickStartedAt = performance.now();
    clicked = await visible.candidate.click({ timeout: 5_000 }).then(() => true).catch(() => false);
    if (clicked) {
      const deadline = performance.now() + 10_000;
      while (performance.now() < deadline) {
        const stillVisible = await visible.candidate.isVisible().catch(() => false);
        if (!stillVisible) {
          disappearedAfterClickMs = Math.round(performance.now() - clickStartedAt);
          break;
        }
        await page.waitForTimeout(100);
      }
    }
  }
  const result = {
    url,
    attempt,
    navigationError,
    domContentLoadedAfterMs,
    startListeningVisible: Boolean(visible),
    startListeningLabel: visible?.label || '',
    startListeningVisibleAfterMs: visibleAfterNavigationMs,
    clicked,
    disappearedAfterClickMs,
  };
  await context.close();
  return result;
}

function percentile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}

async function main() {
  const urls = option('--urls', 'https://www.stationhead.com/sakuramankai,https://www.stationhead.com/buddy46')
    .split(',').map((value) => value.trim()).filter(Boolean);
  const attempts = Math.max(1, Number(option('--attempts', '3')) || 3);
  const out = path.resolve(option('--out', '.sh-start-listening-timing/report.json'));
  await mkdir(path.dirname(out), { recursive: true });
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const samples = [];
  try {
    for (const url of urls) {
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const sample = await measure(browser, url, attempt);
        samples.push(sample);
        console.log(JSON.stringify(sample));
      }
    }
  } finally {
    await browser.close();
  }
  const visibility = samples.map((sample) => sample.startListeningVisibleAfterMs);
  const summary = {
    generatedAt: new Date().toISOString(),
    sampleCount: samples.length,
    visibleCount: visibility.filter(Number.isFinite).length,
    minVisibleAfterMs: percentile(visibility, 0),
    medianVisibleAfterMs: percentile(visibility, 0.5),
    p95VisibleAfterMs: percentile(visibility, 0.95),
    maxVisibleAfterMs: percentile(visibility, 1),
    samples,
  };
  await writeFile(out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.visibleCount !== summary.sampleCount) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
