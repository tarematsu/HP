import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const MODES = [
  { name: 'current', path: '/', panel: '#currentView', tab: '#modeTabs button[data-view="current"]', requiredText: '再生中の曲' },
  { name: 'daily', path: '/#daily', panel: '#historyView', tab: '#modeTabs button[data-mode="daily"]', requiredText: '期間数' },
  { name: 'weekly', path: '/#weekly', panel: '#historyView', tab: '#modeTabs button[data-mode="weekly"]', requiredText: '期間数' },
  { name: 'monthly', path: '/#monthly', panel: '#historyView', tab: '#modeTabs button[data-mode="monthly"]', requiredText: '期間数' },
  { name: 'ranking', path: '/#ranking', panel: '#historyView', tab: '#modeTabs button[data-mode="ranking"]', requiredText: '週間リーダーボード' },
  { name: 'first-week', path: '/#first-week', panel: '#firstWeekView', tab: '#modeTabs button[data-view="first-week"]', requiredText: '比較対象' },
  { name: 'played-tracks', path: '/#played-tracks', panel: '#playedTracksView', tab: '#modeTabs button[data-view="played-tracks"]', requiredText: '楽曲別再生一覧' },
  { name: 'likes', path: '/#likes', panel: '#likesView', tab: '#modeTabs button[data-mode="likes"]', requiredText: '最新いいねランキング' },
  { name: 'broadcasts', path: '/#broadcasts', panel: '#historyView', tab: '#modeTabs button[data-mode="broadcasts"]', requiredText: '公式リスパ一覧' },
  { name: 'unofficial', path: '/#unofficial', panel: '#unofficialView', tab: '#modeTabs button[data-view="unofficial"]', requiredText: '非公式リスパ一覧' },
];

function parseArgs(argv) {
  const options = { url: 'https://skrzk.pages.dev', outDir: '.pages-mobile-compact-audit' };
  for (const arg of argv) {
    if (arg.startsWith('--url=')) options.url = arg.slice('--url='.length);
    else if (arg.startsWith('--out=')) options.outDir = arg.slice('--out='.length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  const url = new URL(options.url);
  if (url.protocol !== 'https:') throw new Error('Compact mobile audit URL must use HTTPS');
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  options.url = url.toString().replace(/\/$/, '');
  return options;
}

async function revealLazyContent(page) {
  await page.evaluate(async () => {
    const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const step = Math.max(420, Math.floor(window.innerHeight * 0.8));
    for (let y = 0, i = 0; y < document.documentElement.scrollHeight && i < 240; y += step, i += 1) {
      window.scrollTo(0, y);
      await settle();
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await settle();
    window.scrollTo(0, 0);
    await settle();
  });
}

async function auditMode(browser, baseUrl, route, outDir) {
  const context = await browser.newContext({
    viewport: { width: 320, height: 720 },
    colorScheme: 'light',
    locale: 'ja-JP',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const failures = [];
  const consoleErrors = new Set();
  const pageErrors = new Set();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.add(message.text());
  });
  page.on('pageerror', (error) => pageErrors.add(error.message));

  const url = new URL(route.path, `${baseUrl}/`).toString();
  let response = null;
  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await page.locator(route.panel).waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator(route.tab).waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForFunction((text) => document.body?.innerText.includes(text), route.requiredText, { timeout: 15_000 }).catch(() => {});
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    await page.waitForTimeout(500);
  } catch (error) {
    failures.push(`navigation failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const bodyText = await page.locator('body').innerText().catch(() => '');
  const mainVisible = await page.locator('main').first().isVisible().catch(() => false);
  const panelVisible = await page.locator(route.panel).isVisible().catch(() => false);
  const selectedTab = await page.locator(route.tab).evaluate((button) => ({
    active: button.classList.contains('active'),
    current: button.getAttribute('aria-current'),
  })).catch(() => ({ active: false, current: null }));

  const layout = await page.evaluate(({ expectedPanel, mode }) => {
    const visible = (element) => {
      if (!element || element.hidden) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const root = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(root.scrollWidth, body?.scrollWidth || 0);
    const tabs = document.querySelector('#modeTabs');
    const tabsRect = tabs?.getBoundingClientRect();
    const clippedTabs = [...(tabs?.querySelectorAll('button') || [])].filter((button) => {
      const rect = button.getBoundingClientRect();
      return tabsRect && (rect.left < tabsRect.left - 1 || rect.right > tabsRect.right + 1);
    }).length;
    const chart = mode === 'played-tracks' ? document.getElementById('playedTracksChart') : null;
    return {
      viewportWidth: window.innerWidth,
      scrollWidth,
      horizontalOverflow: Math.max(0, scrollWidth - window.innerWidth),
      clippedTabs,
      expectedPanelVisible: visible(document.querySelector(expectedPanel)),
      playedTracksChartHeight: chart?.getBoundingClientRect().height ?? null,
    };
  }, { expectedPanel: route.panel, mode: route.name });

  if (!response) failures.push('navigation returned no response');
  else if (response.status() >= 400) failures.push(`document returned HTTP ${response.status()}`);
  if (!mainVisible) failures.push('visible <main> element was not found');
  if (!panelVisible || !layout.expectedPanelVisible) failures.push(`expected panel was not visible: ${route.panel}`);
  if (!selectedTab.active || selectedTab.current !== 'page') failures.push(`selected tab state was not applied: ${route.name}`);
  if (layout.horizontalOverflow > 1) failures.push(`document overflows viewport horizontally by ${layout.horizontalOverflow}px`);
  if (layout.clippedTabs > 0) failures.push(`${layout.clippedTabs} navigation tabs are clipped`);
  if (!bodyText.includes(route.requiredText)) failures.push(`required text was not rendered: ${route.requiredText}`);
  if (route.name === 'played-tracks' && Number(layout.playedTracksChartHeight) < 360) {
    failures.push(`played-tracks chart is too short for compact mobile labels: ${layout.playedTracksChartHeight}px`);
  }
  failures.push(...[...consoleErrors].map((value) => `console error: ${value}`));
  failures.push(...[...pageErrors].map((value) => `page error: ${value}`));

  await revealLazyContent(page).catch(() => {});
  const screenshotPath = join(outDir, `mobile-compact-${route.name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' });
  await context.close();

  return {
    mode: route.name,
    url,
    status: response?.status() ?? null,
    viewport: { width: 320, height: 720 },
    mainVisible,
    panelVisible,
    selectedTab,
    layout,
    screenshotPath,
    failures,
    ok: failures.length === 0,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(options.outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const route of MODES) results.push(await auditMode(browser, options.url, route, options.outDir));
  } finally {
    await browser.close();
  }

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: options.url,
    viewport: { width: 320, height: 720 },
    results,
    ok: results.every((result) => result.ok),
  };
  await writeFile(join(options.outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    '# Pages compact mobile audit',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Result: ${report.ok ? 'PASS' : 'FAIL'}`,
    '',
    '| Mode | HTTP | Overflow | Tabs clipped | Result |',
    '| --- | ---: | ---: | ---: | :---: |',
    ...results.map((result) => `| ${result.mode} | ${result.status ?? '-'} | ${result.layout.horizontalOverflow ?? '-'} | ${result.layout.clippedTabs ?? '-'} | ${result.ok ? 'PASS' : 'FAIL'} |`),
    '',
  ];
  await writeFile(join(options.outDir, 'summary.md'), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
