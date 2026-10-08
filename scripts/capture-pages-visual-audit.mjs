import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NAVIGATION } from '../site/public/dashboard-navigation-config.js';

function parseArgs(argv) {
  const options = {
    url: 'https://skrzk.pages.dev',
    outDir: '.pages-visual-audit',
  };
  for (const arg of argv) {
    if (arg.startsWith('--url=')) options.url = arg.slice('--url='.length);
    else if (arg.startsWith('--out=')) options.outDir = arg.slice('--out='.length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  const parsed = new URL(options.url);
  if (parsed.protocol !== 'https:') throw new Error('Audit URL must use HTTPS');
  options.url = parsed.origin;
  return options;
}

function slug(value) {
  return String(value || 'view')
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'view';
}

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.waitForTimeout(attempt === 0 ? 900 : 350);
    const loading = await page.evaluate(() => {
      const visible = (element) => {
        if (!element || element.hidden) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      return [...document.querySelectorAll('body *')].some((element) => {
        if (!visible(element)) return false;
        return /^読み込み中(?:\.{3}|…)?$/.test((element.textContent || '').trim());
      });
    }).catch(() => false);
    if (!loading) break;
  }
}

async function revealPage(page) {
  await page.evaluate(async () => {
    const raf = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const step = Math.max(420, Math.floor(window.innerHeight * 0.75));
    const max = Math.min(document.documentElement.scrollHeight, 120_000);
    for (let y = 0; y < max; y += step) {
      window.scrollTo(0, y);
      await raf();
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await raf();
    window.scrollTo(0, 0);
    await raf();
  });
}

export function auditRoutes() {
  return NAVIGATION.flatMap((section) => section.sources.flatMap((source) => source.functions.map((item) => ({
    section: section.id, source: source.id, mode: item.mode, text: `${source.label} ${item.label}`,
  })))).map((route, index) => ({ ...route, index }));
}

async function inspectView(page, tab, viewport, outDir) {
  const historyMode = tab.section === 'stationhead' && ['daily', 'weekly', 'monthly'].includes(tab.mode);
  if (historyMode) {
    await page.evaluate(() => {
      window.__pagesAuditHistory = { mode: null, rowCount: null, paintedMode: null };
    });
  }
  await page.evaluate((mode) => { location.hash = mode; }, tab.mode);
  await settle(page);
  let historyWaitTimedOut = false;
  if (historyMode) {
    try {
      await page.waitForFunction((mode) => {
        const history = window.__pagesAuditHistory;
        return history?.mode === mode
          && (history.rowCount === 0 || history.paintedMode === mode);
      }, tab.mode, { timeout: 20_000 });
    } catch {
      historyWaitTimedOut = true;
    }
  }
  if (tab.control) {
    await page.locator('.dashboard-view:not([hidden])').locator(tab.control).click();
    await settle(page);
  }
  await revealPage(page);

  const state = await page.evaluate(({ route }) => {
    const active = document.querySelector('#functionTabs button.active');
    const source = document.querySelector('#sourceTabs button.active')?.dataset.source
      || document.querySelector('#sourceSelect')?.value;
    const visible = (element) => {
      if (!element || element.hidden) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const visiblePanels = [...document.querySelectorAll('.dashboard-view')]
      .filter(visible)
      .map((element) => element.id || element.className);
    const root = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(root.scrollWidth, body?.scrollWidth || 0);
    const text = String(body?.innerText || '').replace(/\s+/g, ' ').trim();
    const suspicious = [];
    for (const token of ['undefined', '[object Object]', 'NaN']) {
      if (text.includes(token)) suspicious.push(token);
    }
    const visibleLoading = [...document.querySelectorAll('body *')].some((element) => {
      if (!visible(element)) return false;
      return /^読み込み中(?:\.{3}|…)?$/.test((element.textContent || '').trim());
    });
    return {
      active: location.hash === `#${route.mode}` && source === route.source,
      ariaCurrent: active?.getAttribute('aria-current') || null,
      dataErrors: text.match(/[^。\n]*(?:データの取得に失敗|データを取得できません|materialized response unavailable)[^。\n]*/g) || [],
      visiblePanels,
      horizontalOverflow: Math.max(0, scrollWidth - window.innerWidth),
      bodyLength: text.length,
      suspicious,
      visibleLoading,
      hash: location.hash,
      title: document.title,
      historyAudit: window.__pagesAuditHistory || null,
    };
  }, { route: tab });

  const name = `${viewport.name}-${String(tab.index + 1).padStart(2, '0')}-${slug(`${tab.mode}${tab.panel ? `-${tab.panel}` : ''}`)}`;
  const screenshot = join(outDir, `${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' });

  const issues = [];
  if (historyWaitTimedOut) issues.push('history data or chart was not rendered within 20 seconds');
  if (historyMode && state.historyAudit?.mode === tab.mode && state.historyAudit.rowCount === 0) {
    issues.push('history summary returned no rows for the full available period');
  }
  if (!state.active) issues.push('selected tab is not marked active');
  if (state.visiblePanels.length !== 1) issues.push(`expected exactly one visible dashboard view, got ${state.visiblePanels.length}`);
  if (state.horizontalOverflow > 1) issues.push(`document horizontally overflows by ${state.horizontalOverflow}px`);
  if (state.bodyLength < 40) issues.push(`body text is unexpectedly short (${state.bodyLength})`);
  if (state.visibleLoading) issues.push('visible loading placeholder remained after settling');
  if (state.dataErrors.length) issues.push(...state.dataErrors);
  if (state.suspicious.length) issues.push(`suspicious rendered tokens: ${state.suspicious.join(', ')}`);

  return {
    tab,
    viewport: viewport.name,
    viewportSize: { width: viewport.width, height: viewport.height },
    screenshot,
    ...state,
    issues,
    ok: issues.length === 0,
  };
}

function expectedNavigationAbort(request) {
  const type = request.resourceType();
  const errorText = String(request.failure()?.errorText || '');
  return ['fetch', 'xhr'].includes(type) && errorText === 'net::ERR_ABORTED';
}

async function auditViewport(browser, baseUrl, viewport, outDir) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: 'light',
    locale: 'ja-JP',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__pagesAuditHistory = { mode: null, rowCount: null, paintedMode: null };
    window.addEventListener('history:data-loaded', (event) => {
      const detail = event.detail || {};
      window.__pagesAuditHistory = {
        mode: String(detail.mode || ''),
        rowCount: Array.isArray(detail.data?.rows) ? detail.data.rows.length : null,
        paintedMode: null,
      };
    });
    window.addEventListener('history:period-chart-drawn', (event) => {
      if (window.__pagesAuditHistory) {
        window.__pagesAuditHistory.paintedMode = String(event.detail?.mode || '');
      }
    });
  });
  const consoleErrors = new Set();
  const pageErrors = new Set();
  const requestFailures = new Set();

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.add(message.text());
  });
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.startsWith('/api/') && response.status() >= 400) {
      requestFailures.add(`HTTP ${response.status()} ${response.url()}`);
    }
  });
  page.on('pageerror', (error) => pageErrors.add(error.message));
  page.on('requestfailed', (request) => {
    const type = request.resourceType();
    if (expectedNavigationAbort(request)) return;
    if (['document', 'script', 'stylesheet', 'fetch', 'xhr'].includes(type)) {
      requestFailures.add(`${type} ${request.url()} ${request.failure()?.errorText || 'failed'}`);
    }
  });

  const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 35_000 });
  await page.locator('#sectionTabs button').first().waitFor({ state: 'visible', timeout: 15_000 });
  await settle(page);

  const tabs = auditRoutes();
  if (!tabs.length) throw new Error('No visible navigation tabs were found');

  const views = [];
  for (const tab of tabs) {
    try {
      views.push(await inspectView(page, tab, viewport, outDir));
      const panels = await page.locator('.dashboard-view:not([hidden]) :is(button[data-stationhead-section], button[data-service-group]):visible:not(:disabled)').evaluateAll((buttons) => buttons.map((button) => {
        const attribute = button.hasAttribute('data-stationhead-section') ? 'data-stationhead-section' : 'data-service-group';
        return { panel: button.getAttribute(attribute), control: `button[${attribute}="${button.getAttribute(attribute)}"]` };
      }));
      for (const panel of panels) views.push(await inspectView(page, { ...tab, ...panel }, viewport, outDir));
    } catch (error) {
      const screenshot = join(outDir, `${viewport.name}-${tab.index + 1}-failed.png`);
      await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' }).catch(() => {});
      views.push({ tab, viewport: viewport.name, screenshot, ok: false, issues: [String(error?.message || error)] });
    }
  }

  await context.close();
  return {
    viewport,
    status: response?.status() ?? null,
    tabs,
    views,
    consoleErrors: [...consoleErrors],
    pageErrors: [...pageErrors],
    requestFailures: [...requestFailures],
  };
}

export async function runVisualAudit(argv = process.argv.slice(2)) {
  const { chromium } = await import('playwright');
const options = parseArgs(argv);
await mkdir(options.outDir, { recursive: true });

const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'mobile-compact', width: 320, height: 720 },
];

const browser = await chromium.launch({ headless: true });
const results = [];
let fatal = null;
try {
  for (const viewport of viewports) {
    results.push(await auditViewport(browser, options.url, viewport, options.outDir));
  }
} catch (error) {
  fatal = error instanceof Error ? error.stack || error.message : String(error);
} finally {
  await browser.close();
}

const allViews = results.flatMap((result) => result.views);
const report = {
  generatedAt: new Date().toISOString(),
  url: options.url,
  viewports: results,
  summary: {
    screenshotCount: allViews.length,
    failedViewCount: allViews.filter((view) => !view.ok).length,
    consoleErrorCount: results.reduce((sum, result) => sum + result.consoleErrors.length, 0),
    pageErrorCount: results.reduce((sum, result) => sum + result.pageErrors.length, 0),
    requestFailureCount: results.reduce((sum, result) => sum + result.requestFailures.length, 0),
  },
  fatal,
};

await writeFile(join(options.outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.summary));

const issueCount = report.summary.failedViewCount
  + report.summary.consoleErrorCount
  + report.summary.pageErrorCount
  + report.summary.requestFailureCount;
if (fatal || issueCount > 0) {
  if (fatal) console.error(fatal);
  if (issueCount > 0) console.error(`Visual audit detected ${issueCount} issue(s).`);
  process.exitCode = 1;
}

}

if (import.meta.url === `file://${process.argv[1]}`) await runVisualAudit();
