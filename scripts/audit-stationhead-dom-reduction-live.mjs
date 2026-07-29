import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function option(name, fallback = '') {
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) {
    return process.argv[index + 1];
  }
  return fallback;
}

const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const startPattern = /start\s+listening|listen\s+(?:now|live)|join\s+(?:station|room)|resume|continue|再生|聴く|参加/i;

function extractDomScript(source) {
  const names = [
    'StationheadStartupDomBatchFixedScript',
    'StationheadStartupDomReductionScript',
  ];
  for (const name of names) {
    const start = source.indexOf(`inline std::wstring ${name}`);
    if (start < 0) continue;
    const section = source.slice(start);
    const match = section.match(/LR"JS\(([\s\S]*?)\)JS"/);
    if (match) return match[1];
  }
  throw new Error('Final Stationhead DOM reduction raw script was not found');
}

async function candidateLabel(locator) {
  return locator.evaluate((node) => [
    node.textContent || '',
    node.getAttribute('aria-label') || '',
    node.getAttribute('title') || '',
    node.getAttribute('value') || '',
  ].join(' ').replace(/\s+/g, ' ').trim()).catch(() => '');
}

async function findPlaybackCandidate(page, timeoutMs = 15_000) {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  do {
    const candidates = page.locator(
      'button,[role="button"],a,input[type="button"],input[type="submit"]',
    );
    const count = Math.min(await candidates.count(), 300);
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      if (!await candidate.isVisible().catch(() => false)) continue;
      const label = await candidateLabel(candidate);
      if (startPattern.test(label)) return { candidate, label: label.slice(0, 160) };
    }
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(400);
  } while (true);
  return null;
}

async function snapshot(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      if (!element?.isConnected || element.getAttribute?.('aria-hidden') === 'true') return false;
      const rect = element.getBoundingClientRect?.();
      if (!rect || rect.width <= 2 || rect.height <= 2) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity || 1) > 0;
    };
    const optionalSelector = [
      '[data-testid*="gif" i]',
      '[data-testid*="chat" i]',
      '[data-testid*="thread" i]',
      '[data-testid*="tipping" i]',
      '[data-testid*="gift" i]',
      '[data-testid*="reaction" i]',
      '[data-testid*="emoji" i]',
      '[data-testid*="leaderboard" i]',
      '[data-testid*="apple-music" i]',
      '[data-testid*="free-trial" i]',
      '[data-testid*="download-app" i]',
      '[aria-label*="gif" i]',
      '[aria-label*="open chat" i]',
      '[aria-label*="send gift" i]',
      'img[src*="giphy" i]',
      'img[src*="/gif" i]',
    ].join(',');
    const optionalElements = [...document.querySelectorAll(optionalSelector)];
    const optionalVisibleElements = optionalElements
      .filter(visible)
      .slice(0, 20)
      .map((element) => describe(element));
    const optionalRemainingElements = optionalElements
      .slice(0, 20)
      .map((element) => describe(element));
    return {
      url: location.href,
      bodyText: normalizeForReport(document.body?.innerText || ''),
      optionalTotal: optionalElements.length,
      optionalVisible: optionalVisibleElements.length,
      optionalVisibleElements,
      optionalRemainingElements,
      reductionInstalled: window.__homepanelStationheadStartupDomReduction === true,
    };

    function describe(element) {
      return {
        tag: element.tagName.toLowerCase(),
        testId: String(element.getAttribute('data-testid') || '').slice(0, 160),
        ariaLabel: String(element.getAttribute('aria-label') || '').slice(0, 160),
        title: String(element.getAttribute('title') || '').slice(0, 160),
        src: String(element.getAttribute('src') || '').slice(0, 240),
        text: normalizeForReport(element.textContent || '').slice(0, 240),
      };
    }

    function normalizeForReport(value) {
      return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 1600);
    }
  });
}

async function main() {
  const targetUrl = option('--url', 'https://www.stationhead.com/sakuramankai');
  const outPath = path.resolve(option('--out', '.sh-js-audit/dom-reduction.json'));
  const header = await readFile(
    'hp/native/src/sh_startup_dom_batch_policy_fix.h',
    'utf8',
  );
  const domScript = extractDomScript(header);
  // Parse before browser launch so malformed C++-embedded JavaScript fails clearly.
  new Function(domScript);

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1365, height: 900 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36',
  });
  const pageErrors = [];
  try {
    await context.addInitScript({ content: domScript });
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(String(error.message || error).slice(0, 2000)));
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => null);

    const before = await snapshot(page);
    const playback = await findPlaybackCandidate(page);
    const startListeningVisible = Boolean(playback);
    const clicked = playback
      ? await playback.candidate.click({ timeout: 5000 }).then(() => true).catch(() => false)
      : false;
    if (clicked) await page.waitForTimeout(5000);
    const after = await snapshot(page);
    const startStillVisible = Boolean(await findPlaybackCandidate(page, 0));
    const afterClickScreenVisible = Boolean(
      clicked && after.bodyText &&
      (!startStillVisible || normalize(before.bodyText) !== normalize(after.bodyText) || before.url !== after.url),
    );
    const passed = Boolean(
      before.reductionInstalled && startListeningVisible && clicked &&
      afterClickScreenVisible && before.optionalTotal === 0 &&
      after.optionalTotal === 0 && pageErrors.length === 0,
    );
    const report = {
      passed,
      targetUrl,
      startListeningVisible,
      clicked,
      afterClickScreenVisible,
      optionalTotalBeforeClick: before.optionalTotal,
      optionalVisibleBeforeClick: before.optionalVisible,
      optionalVisibleBeforeClickElements: before.optionalVisibleElements,
      optionalRemainingBeforeClickElements: before.optionalRemainingElements,
      optionalTotalAfterClick: after.optionalTotal,
      optionalVisibleAfterClick: after.optionalVisible,
      optionalVisibleAfterClickElements: after.optionalVisibleElements,
      optionalRemainingAfterClickElements: after.optionalRemainingElements,
      reductionInstalled: before.reductionInstalled,
      pageErrors,
    };
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    if (!passed) process.exitCode = 2;
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
