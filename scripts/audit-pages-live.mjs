import { createHash } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const DEFAULT_TARGETS = [
  { name: 'pages', baseUrl: 'https://skrzk.pages.dev' },
];

const MODES = [
  {
    name: 'current',
    path: '/',
    panel: '#currentView',
    tab: '#modeTabs button[data-view="current"]',
    requiredText: '再生中の曲',
  },
  {
    name: 'daily',
    path: '/#daily',
    panel: '#historyView',
    tab: '#modeTabs button[data-mode="daily"]',
    requiredText: '期間数',
    notice: '#notice',
  },
  {
    name: 'hinata',
    path: '/#hinata',
    panel: '#hinataView',
    tab: '#sourceTabs button[data-source="hinata"]',
    notice: '#hinataNotice',
  },
  {
    name: 'nogizaka',
    path: '/#nogizaka',
    panel: '#nogizakaListeningPartyView',
    tab: '#sourceTabs button[data-source="nogizaka"]',
    notice: '#nogizakaListeningPartyNotice',
  },
  {
    name: 'ranking',
    path: '/#ranking',
    panel: '#historyView',
    tab: '#sourceTabs button[data-source="ranking"]',
    requiredText: '総週数',
    notice: '#notice',
  },
  {
    name: 'followers',
    path: '/#followers',
    panel: '#followersView',
    tab: '#sourceTabs button[data-source="followers"]',
    notice: '#followersNotice',
  },
  {
    name: 'played-tracks',
    path: '/#played-tracks',
    panel: '#playedTracksView',
    tab: '#modeTabs button[data-view="played-tracks"]',
    requiredText: '楽曲別再生一覧',
    notice: '#playedTracksNotice',
  },
  {
    name: 'spotify',
    path: '/#spotify',
    panel: '#spotifyView',
    tab: '#sourceTabs button[data-source="spotify"]',
    notice: '#spotifyNotice',
  },
  {
    name: 'apple-music',
    path: '/#apple-music',
    panel: '#appleMusicView',
    tab: '#sourceTabs button[data-source="apple-music"]',
    notice: '#appleMusicNotice',
  },
  {
    name: 'amazon-music',
    path: '/#amazon-music',
    panel: '#amazonMusicView',
    tab: '#sourceTabs button[data-source="amazon-music"]',
    notice: '#amazonMusicNotice',
  },
  {
    name: 'youtube-music',
    path: '/#youtube-music',
    panel: '#youtubeMusicView',
    tab: '#sourceTabs button[data-source="youtube-music"]',
    notice: '#youtubeMusicNotice',
  },
  {
    name: 'likes',
    path: '/#likes',
    panel: '#likesView',
    tab: '#modeTabs button[data-mode="likes"]',
    requiredText: '最新いいねランキング',
    notice: '#likesNotice',
  },
  {
    name: 'broadcasts',
    path: '/#broadcasts',
    panel: '#historyView',
    tab: '#modeTabs button[data-mode="broadcasts"]',
    requiredText: '非公式リスパ一覧',
    additionalRequiredText: '比較対象',
    notice: '#notice',
    legendSelector: '#chartLegend span',
    minLegendItems: 6,
  },
];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 1000, modes: MODES.map(({ name }) => name) },
  { name: 'tablet', width: 820, height: 1180, modes: ['current', 'daily', 'hinata', 'followers', 'spotify', 'likes'] },
  { name: 'mobile', width: 390, height: 844, modes: MODES.map(({ name }) => name) },
  { name: 'mobile-compact', width: 320, height: 720, modes: ['current', 'daily', 'likes', 'played-tracks', 'spotify', 'broadcasts'] },
];

function parseArgs(argv) {
  const options = {
    outDir: '.pages-live-audit',
    attempts: 2,
    retryDelayMs: 5_000,
    targets: [],
  };

  for (const arg of argv) {
    if (arg.startsWith('--out=')) options.outDir = arg.slice('--out='.length);
    else if (arg.startsWith('--attempts=')) options.attempts = Number(arg.slice('--attempts='.length));
    else if (arg.startsWith('--retry-delay-ms=')) options.retryDelayMs = Number(arg.slice('--retry-delay-ms='.length));
    else if (arg.startsWith('--url=')) {
      const baseUrl = normalizeBaseUrl(arg.slice('--url='.length));
      options.targets.push({ name: new URL(baseUrl).hostname, baseUrl });
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.attempts) || options.attempts < 1 || options.attempts > 10) {
    throw new Error('--attempts must be an integer between 1 and 10');
  }
  if (!Number.isFinite(options.retryDelayMs) || options.retryDelayMs < 0 || options.retryDelayMs > 60_000) {
    throw new Error('--retry-delay-ms must be between 0 and 60000');
  }
  if (!options.targets.length) options.targets = DEFAULT_TARGETS;
  return options;
}

export function normalizeBaseUrl(value) {
  const url = new URL(String(value || '').trim());
  if (url.protocol !== 'https:') throw new Error(`Live audit URL must use HTTPS: ${value}`);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function fileSafe(value) {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'page';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAuditedResponse(response, target) {
  const request = response.request();
  const type = request.resourceType();
  const url = new URL(response.url());
  const sameTarget = url.origin === new URL(target.baseUrl).origin;
  return ['document', 'script', 'stylesheet', 'fetch', 'xhr'].includes(type)
    || (sameTarget && url.pathname.startsWith('/api/'));
}

async function waitForMode(page, route) {
  await page.locator(route.panel).waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator(route.tab).waitFor({ state: 'visible', timeout: 15_000 });
  if (route.notice) {
    await page.waitForFunction((selector) => {
      const element = document.querySelector(selector);
      const text = String(element?.textContent || '').trim();
      return element && !/^(?:読み込み中|表示するタブを選択)/.test(text);
    }, route.notice, { timeout: 10_000 }).catch(() => {});
  }
  if (route.legendSelector && route.minLegendItems) {
    await page.waitForFunction(({ selector, minimum }) =>
      document.querySelectorAll(selector).length >= minimum,
    { selector: route.legendSelector, minimum: route.minLegendItems }, { timeout: 15_000 }).catch(() => {});
  }
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(500);
}

async function revealLazyContent(page) {
  await page.evaluate(async () => {
    const settle = () => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    const step = Math.max(420, Math.floor(window.innerHeight * 0.8));
    let position = 0;
    let iterations = 0;
    while (position < document.documentElement.scrollHeight && iterations < 240) {
      window.scrollTo(0, position);
      await settle();
      position += step;
      iterations += 1;
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await settle();
    window.scrollTo(0, 0);
    await settle();
  }).catch(() => {});
}

async function auditRoute(browser, target, route, viewport, outDir) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: 'light',
    locale: 'ja-JP',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const consoleErrors = new Set();
  const pageErrors = new Set();
  const requestFailures = new Set();
  const httpErrors = new Set();

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.add(message.text());
  });
  page.on('pageerror', (error) => pageErrors.add(error.message));
  page.on('requestfailed', (request) => {
    const resourceType = request.resourceType();
    if (['document', 'script', 'stylesheet', 'fetch', 'xhr'].includes(resourceType)) {
      requestFailures.add(`${resourceType} ${request.url()}: ${request.failure()?.errorText || 'failed'}`);
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && isAuditedResponse(response, target)) {
      httpErrors.add(`${response.status()} ${response.request().resourceType()} ${response.url()}`);
    }
  });

  const url = new URL(route.path, `${target.baseUrl}/`).toString();
  const failures = [];
  let response = null;
  let navigationError = null;

  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await waitForMode(page, route);
  } catch (error) {
    navigationError = error instanceof Error ? error.message : String(error);
  }

  const title = await page.title().catch(() => '');
  const bodyText = compactText(await page.locator('body').innerText({ timeout: 5_000 }).catch(() => ''));
  const mainVisible = await page.locator('main').first().isVisible().catch(() => false);
  const panelVisible = await page.locator(route.panel).isVisible().catch(() => false);
  const selectedTab = await page.locator(route.tab).evaluate((button) => ({
    active: button.classList.contains('active'),
    current: button.getAttribute('aria-current'),
    pressed: button.getAttribute('aria-pressed'),
  })).catch(() => ({ active: false, current: null, pressed: null }));
  const legendItems = route.legendSelector
    ? await page.locator(route.legendSelector).count().catch(() => 0)
    : null;
  const panelSelectors = [...new Set(MODES.map(({ panel }) => panel))];
  const layout = await page.evaluate(({ expectedPanel, selectedSelector, panelsToCheck }) => {
    const visible = (element) => {
      if (!element || element.hidden) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const panels = panelsToCheck.filter((selector) => visible(document.querySelector(selector)));
    const root = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(root.scrollWidth, body?.scrollWidth || 0);
    const navLists = [...document.querySelectorAll('#sectionTabs, #sourceTabs, #modeTabs, .dashboard-source-row')]
      .filter(visible);
    let clippedTabs = 0;
    let clippedWithoutScroll = 0;
    let scrollableLists = 0;
    for (const list of navLists) {
      const rect = list.getBoundingClientRect();
      const buttons = [...list.querySelectorAll(':scope > button')].filter(visible);
      const clipped = buttons.filter((button) => {
        const buttonRect = button.getBoundingClientRect();
        return buttonRect.left < rect.left - 1 || buttonRect.right > rect.right + 1;
      }).length;
      if (!clipped) continue;
      clippedTabs += clipped;
      const style = getComputedStyle(list);
      const scrollable = list.scrollWidth > list.clientWidth + 1
        && ['auto', 'scroll'].includes(style.overflowX);
      if (scrollable) scrollableLists += 1;
      else clippedWithoutScroll += clipped;
    }
    const selected = document.querySelector(selectedSelector);
    const selectedRect = selected?.getBoundingClientRect();
    const selectedParent = selected?.parentElement;
    const selectedParentRect = selectedParent?.getBoundingClientRect();
    const selectedTabClipped = Boolean(
      visible(selected)
      && selectedParentRect
      && selectedRect
      && (selectedRect.left < selectedParentRect.left - 1 || selectedRect.right > selectedParentRect.right + 1),
    );
    const duplicateIds = [...document.querySelectorAll('[id]')]
      .map((element) => element.id)
      .filter((id, index, ids) => id && ids.indexOf(id) !== index)
      .filter((id, index, ids) => ids.indexOf(id) === index);
    const visibleTables = [...document.querySelectorAll('table')].filter(visible);
    const tableRows = visibleTables.reduce((sum, table) => sum + table.querySelectorAll('tbody tr').length, 0);
    const cells = visibleTables.flatMap((table) => [...table.querySelectorAll('tbody td')]);
    const missingCells = cells.filter((cell) => /^(?:—|-)$/.test(cell.textContent.trim())).length;
    return {
      viewportWidth: window.innerWidth,
      scrollWidth,
      horizontalOverflow: Math.max(0, scrollWidth - window.innerWidth),
      visiblePanels: panels,
      expectedPanelVisible: visible(document.querySelector(expectedPanel)),
      clippedTabs,
      clippedWithoutScroll,
      navigationScrollable: scrollableLists > 0,
      selectedTabClipped,
      duplicateIds,
      tableRows,
      missingCells,
      tableCells: cells.length,
    };
  }, {
    expectedPanel: route.panel,
    selectedSelector: route.tab,
    panelsToCheck: panelSelectors,
  }).catch(() => ({
    viewportWidth: viewport.width,
    scrollWidth: null,
    horizontalOverflow: null,
    visiblePanels: [],
    expectedPanelVisible: false,
    clippedTabs: null,
    clippedWithoutScroll: null,
    navigationScrollable: false,
    selectedTabClipped: null,
    duplicateIds: [],
    tableRows: null,
    missingCells: null,
    tableCells: null,
  }));
  const malformedTokens = ['NaN', 'undefined', '[object Object]', 'Invalid Date']
    .filter((token) => bodyText.includes(token));
  const finalUrl = page.url();
  const screenshotPath = join(
    outDir,
    `${fileSafe(target.name)}-${fileSafe(viewport.name)}-${fileSafe(route.name)}.png`,
  );
  await revealLazyContent(page);
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' }).catch(() => {});

  if (navigationError) failures.push(`navigation failed: ${navigationError}`);
  if (!response) failures.push('navigation returned no response');
  else if (response.status() >= 400) failures.push(`document returned HTTP ${response.status()}`);
  if (!finalUrl.startsWith('https://')) failures.push(`final URL is not HTTPS: ${finalUrl}`);
  if (!mainVisible) failures.push('visible <main> element was not found');
  if (!panelVisible || !layout.expectedPanelVisible) failures.push(`expected panel was not visible: ${route.panel}`);
  const selectedStateApplied = selectedTab.active
    && (selectedTab.current === 'page' || selectedTab.pressed === 'true');
  if (!selectedStateApplied) failures.push(`selected tab state was not applied: ${route.name}`);
  if (layout.visiblePanels.length !== 1 || layout.visiblePanels[0] !== route.panel) {
    failures.push(`unexpected visible panels: ${layout.visiblePanels.join(', ') || 'none'}`);
  }
  if (Number(layout.horizontalOverflow) > 1) {
    failures.push(`document overflows viewport horizontally by ${layout.horizontalOverflow}px`);
  }
  if (Number(layout.clippedWithoutScroll) > 0) {
    failures.push(`${layout.clippedWithoutScroll} visible navigation tabs are clipped without a scrollable tab list`);
  }
  if (layout.selectedTabClipped) failures.push('selected navigation tab is clipped');
  if (layout.duplicateIds.length) failures.push(`duplicate DOM ids: ${layout.duplicateIds.join(', ')}`);
  if (malformedTokens.length) failures.push(`malformed rendered values: ${malformedTokens.join(', ')}`);
  if (bodyText.length < 20) failures.push(`page body is unexpectedly short (${bodyText.length} characters)`);
  if (route.requiredText && !bodyText.includes(route.requiredText)) {
    failures.push(`required text was not rendered: ${route.requiredText}`);
  }
  if (route.additionalRequiredText && !bodyText.includes(route.additionalRequiredText)) {
    failures.push(`required text was not rendered: ${route.additionalRequiredText}`);
  }
  if (route.minLegendItems && Number(legendItems) < route.minLegendItems) {
    failures.push(`official listening party graph rendered ${legendItems} series; expected at least ${route.minLegendItems}`);
  }
  failures.push(...[...consoleErrors].map((value) => `console error: ${value}`));
  failures.push(...[...pageErrors].map((value) => `page error: ${value}`));
  failures.push(...[...requestFailures].map((value) => `request failure: ${value}`));
  failures.push(...[...httpErrors].map((value) => `HTTP error: ${value}`));

  await context.close();
  return {
    mode: route.name,
    viewport: viewport.name,
    viewportSize: { width: viewport.width, height: viewport.height },
    path: route.path,
    requestedUrl: url,
    finalUrl,
    status: response?.status() ?? null,
    title,
    mainVisible,
    panelVisible,
    selectedTab,
    legendItems,
    layout,
    dataQuality: {
      malformedTokens,
      tableRows: layout.tableRows,
      missingCells: layout.missingCells,
      tableCells: layout.tableCells,
    },
    bodyLength: bodyText.length,
    bodyDigest: digest(bodyText),
    bodyPreview: bodyText.slice(0, 240),
    screenshotPath,
    consoleErrors: [...consoleErrors],
    pageErrors: [...pageErrors],
    requestFailures: [...requestFailures],
    httpErrors: [...httpErrors],
    failures,
    ok: failures.length === 0,
  };
}

async function auditHealth(target) {
  const url = new URL('/api/health', `${target.baseUrl}/`).toString();
  const failures = [];
  let status = null;
  let payload = null;
  let error = null;

  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    status = response.status;
    payload = await response.json().catch(() => null);
    if (!response.ok) failures.push(`health endpoint returned HTTP ${response.status}`);
    if (payload?.ok !== true) failures.push('health endpoint did not return { ok: true }');
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    failures.push(`health request failed: ${error}`);
  }

  return { url, status, payload, error, failures, ok: failures.length === 0 };
}

async function auditTarget(browser, target, outDir) {
  const routes = [];
  for (const viewport of VIEWPORTS) {
    for (const modeName of viewport.modes) {
      const route = MODES.find(({ name }) => name === modeName);
      routes.push(await auditRoute(browser, target, route, viewport, outDir));
    }
  }
  const health = await auditHealth(target);
  const failures = [
    ...routes.flatMap((route) => route.failures.map(
      (failure) => `${route.viewport}/${route.mode}: ${failure}`,
    )),
    ...health.failures.map((failure) => `/api/health: ${failure}`),
  ];
  return { ...target, routes, health, failures, ok: failures.length === 0 };
}

function markdownSummary(report) {
  const lines = [
    '# Pages live browser audit',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Result: ${report.ok ? 'PASS' : 'FAIL'}`,
    '',
    '| Target | Viewport | Mode | HTTP | Panel | Overflow | Missing cells | Result |',
    '| --- | --- | --- | ---: | :---: | ---: | ---: | :---: |',
  ];

  for (const target of report.targets) {
    for (const route of target.routes) {
      lines.push(`| ${target.baseUrl} | ${route.viewport} | ${route.mode} | ${route.status ?? '-'} | ${route.panelVisible ? 'yes' : 'no'} | ${route.layout.horizontalOverflow ?? '-'} | ${route.dataQuality.missingCells ?? '-'} | ${route.ok ? 'PASS' : 'FAIL'} |`);
    }
    lines.push(`| ${target.baseUrl} | - | /api/health | ${target.health.status ?? '-'} | - | - | - | ${target.health.ok ? 'PASS' : 'FAIL'} |`);
  }

  const failures = report.targets.flatMap((target) => target.failures.map((failure) => `- **${target.name}** ${failure}`));
  if (failures.length) lines.push('', '## Failures', '', ...failures);
  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(options.outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  let report;

  try {
    for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
      const targets = [];
      for (const target of options.targets) targets.push(await auditTarget(browser, target, options.outDir));
      report = {
        generatedAt: new Date().toISOString(),
        attempt,
        attempts: options.attempts,
        targets,
        ok: targets.every((target) => target.ok),
      };
      if (report.ok || attempt === options.attempts) break;
      await sleep(options.retryDelayMs);
    }
  } finally {
    await browser.close();
  }

  const jsonPath = join(options.outDir, 'report.json');
  const summaryPath = join(options.outDir, 'summary.md');
  const summary = markdownSummary(report);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(summaryPath, summary, 'utf8');
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, 'utf8');
  process.stdout.write(summary);
  if (!report.ok) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
