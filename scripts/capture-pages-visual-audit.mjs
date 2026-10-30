import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NAVIGATION } from '../site/public/dashboard-navigation-config.js';
import { auditPagesData } from './pages-data-audit.mjs';

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

const KKBOX_SERIES_FILTERS = Object.freeze([
  'tw:newrelease',
  'hk:newrelease',
  'tw:song',
  'hk:song',
]);
const KKBOX_PERIOD_FILTERS = Object.freeze(['daily', 'weekly']);

export function kkboxAuditRoutes(route) {
  if (route?.mode !== 'kkbox') return [];
  return KKBOX_SERIES_FILTERS.flatMap((series) => KKBOX_PERIOD_FILTERS.map((period) => ({
    ...route,
    panel: `${series.replace(':', '-')}-${period}`,
    controls: [
      `button[data-kkbox-series-filter="${series}"]`,
      `button[data-kkbox-period-filter="${period}"]`,
    ],
    kkboxSelection: { series, period },
  })));
}

async function inspectView(page, tab, viewport, outDir) {
  const historyMode = tab.section === 'stationhead' && ['daily', 'weekly', 'monthly'].includes(tab.mode);
  const listeningPartyMode = tab.section === 'stationhead' && tab.source === 'buddies' && tab.mode === 'broadcasts';
  const nogizakaBroadcastMode = tab.section === 'stationhead' && tab.source === 'nogizaka' && tab.mode === 'nogizaka';
  const leaderboardMode = tab.mode === 'ranking';
  const playedTracksMode = ['played-tracks', 'hinata-played-tracks'].includes(tab.mode);
  const kkboxMode = Boolean(tab.kkboxSelection);
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
  let leaderboardWaitTimedOut = false;
  if (leaderboardMode) {
    try {
      await page.waitForFunction(() => {
        const cadence = document.getElementById('leaderboardCadence')?.textContent?.trim();
        const tableRows = document.querySelectorAll('#leaderboardTbody tr').length;
        const mobileCards = document.getElementById('leaderboardMobileList')?.children.length || 0;
        const emptyVisible = !document.getElementById('leaderboardChartEmpty')?.hidden;
        return Boolean(cadence && cadence !== '-' && (tableRows > 0 || mobileCards > 0 || emptyVisible));
      }, null, { timeout: 20_000 });
    } catch {
      leaderboardWaitTimedOut = true;
    }
  }
  let listeningPartyWaitTimedOut = false;
  let nogizakaBroadcastWaitTimedOut = false;
  if (listeningPartyMode) {
    // The comparison panels are rendered lazily. On narrow viewports they sit
    // well below the fold, so reveal them before waiting for their paint state.
    await revealPage(page);
    await settle(page);
    try {
      await page.waitForFunction(() => {
        const visible = (element) => {
          if (!element || element.hidden) return false;
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const officialChart = document.getElementById('chart');
        const officialTable = document.getElementById('thead')?.closest('table');
        const firstWeek = document.getElementById('firstWeekView');
        const firstWeekChart = document.getElementById('firstWeekChart');
        const unofficial = document.getElementById('unofficialListeningPanel');
        return visible(firstWeek)
          && visible(unofficial)
          && Number(officialChart?.dataset.sakurazakaMaxMinute || 0) > 0
          && officialTable?.dataset.officialPartyReadModel === 'complete'
          && Number(firstWeekChart?.dataset.firstWeekWidth || 0) > 0
          && document.querySelectorAll('#firstWeekTbody tr').length > 0
          && document.querySelectorAll('#unofficialListeningTbody tr').length > 0;
      }, null, { timeout: 45_000 });
    } catch {
      listeningPartyWaitTimedOut = true;
    }
  }
  const controls = Array.isArray(tab.controls) ? tab.controls : tab.control ? [tab.control] : [];
  for (const control of controls) {
    await page.locator('.dashboard-view:not([hidden])').locator(control).click();
    await settle(page);
  }

  let kkboxWaitTimedOut = false;
  if (kkboxMode) {
    try {
      await page.waitForFunction(({ series, period }) => {
        const selected = (attribute, value) => [...document.querySelectorAll(`[data-${attribute}]`)]
          .some((button) => button.getAttribute(`data-${attribute}`) === value
            && button.getAttribute('aria-pressed') === 'true');
        const body = document.getElementById('kkboxJapaneseHistoryBody');
        const chart = document.getElementById('kkboxJapaneseRankChart');
        const chartReady = Boolean(chart && (
          chart.querySelector('canvas, svg, .shared-empty') || (chart.textContent || '').trim()
        ));
        return selected('kkbox-series-filter', series)
          && selected('kkbox-period-filter', period)
          && Boolean(body && body.children.length > 0 && chartReady);
      }, tab.kkboxSelection, { timeout: 20_000 });
    } catch {
      kkboxWaitTimedOut = true;
    }
  }

  // Nogizaka shares the Stationhead broadcast renderer, but its async read model
  // is not covered by the Sakurazaka-specific listening-party wait above. Wait
  // for the summary and table to be populated before capturing this route at
  // every viewport; network idle alone can occur before its first render.
  if (nogizakaBroadcastMode) {
    try {
      await page.waitForFunction(() => {
        const panel = document.querySelector('#nogizakaListeningPartyView:not([hidden])');
        if (!panel) return false;
        const count = panel.querySelector('[data-role="broadcast-count"]')?.textContent?.trim();
        const body = panel.querySelector('[data-role="broadcast-tbody"]');
        const chart = panel.querySelector('[data-role="broadcast-chart"]');
        const empty = panel.querySelector('[data-role="broadcast-chart-empty"]');
        const notice = panel.querySelector('[data-role="notice"]');
        const failed = notice && !notice.hidden && /データの取得に失敗|初期化に失敗/.test(notice.textContent || '');
        const chartResolved = Boolean((chart && !chart.hidden) || (empty && !empty.hidden));
        return Boolean(failed || (count && count !== '—' && body && body.children.length > 0 && chartResolved));
      }, null, { timeout: 20_000 });
    } catch {
      nogizakaBroadcastWaitTimedOut = true;
    }
  }

  // Track-history panels fetch the date index and selected period in sequence.
  // Network idle alone can occur between those requests, so wait for the actual
  // metrics and either data rows or the explicit empty state before capture.
  let playedTracksWaitTimedOut = false;
  if (playedTracksMode) {
    try {
      await page.waitForFunction(() => {
        const panel = document.querySelector('.dashboard-view:not([hidden]) [data-stationhead-panel="played-tracks"]:not([hidden])');
        if (!panel) return false;
        const total = panel.querySelector('[data-role="played-total"]')?.textContent?.trim();
        const unique = panel.querySelector('[data-role="played-unique"]')?.textContent?.trim();
        const body = panel.querySelector('[data-role="played-tbody"]');
        return Boolean(total && total !== '—' && unique && unique !== '—' && body && body.children.length > 0);
      }, null, { timeout: 20_000 });
    } catch {
      playedTracksWaitTimedOut = true;
    }
  }

  // A quiet network is not proof that a lazy music-service panel has painted.
  // Wait for each chart/table (including explicit empty states) before saving
  // the screenshot, otherwise a fast viewport can capture an apparently blank
  // panel while slower viewports capture its completed state.
  let serviceRenderWaitTimedOut = false;
  if (tab.section === 'subscriptions') {
    const serviceGroup = await page.evaluate((requestedGroup) => {
      const root = document.querySelector('.dashboard-view:not([hidden])');
      if (!root) return '__missing-root__';
      const hasGroupPanels = Boolean(root.querySelector('.music-service-group[data-group]'));
      return hasGroupPanels ? (requestedGroup || root.dataset.activeServiceGroup || '__missing-group__') : '';
    }, tab.panel || '');
    if (serviceGroup === '__missing-root__' || serviceGroup === '__missing-group__') {
      serviceRenderWaitTimedOut = true;
    } else {
      try {
        await page.waitForFunction((group) => {
          const root = document.querySelector('.dashboard-view:not([hidden])');
          if (!root) return false;
          let sections;
          if (group) {
            if (root.dataset.activeServiceGroup !== group) return false;
            const panel = [...root.querySelectorAll('.music-service-group[data-group]')].find((item) => item.dataset.group === group);
            if (!panel || panel.hidden) return false;
            sections = [...panel.querySelectorAll('.music-service-section')];
          } else {
            if (root.querySelector('.music-service-group[data-group]')) return false;
            sections = [...root.querySelectorAll('.music-service-section')].filter((section) => !section.hidden);
          }
          if (!sections.length) return false;

          let renderTargets = 0;
          for (const section of sections) {
            const charts = [...section.querySelectorAll(
              '.music-service-rank-chart, .spotify-trend-charts, .music-service-bar-chart',
            )];
            const tableBodies = [...section.querySelectorAll('table tbody')];
            renderTargets += charts.length + tableBodies.length;
            if (charts.some((chart) => !(
              chart.matches('canvas, svg')
              || chart.querySelector('canvas, svg, .shared-empty')
            ))) return false;
            if (tableBodies.some((body) => body.children.length === 0)) return false;
          }
          return renderTargets > 0;
        }, serviceGroup, { timeout: 20_000 });
      } catch {
        serviceRenderWaitTimedOut = true;
      }
    }
  }
  await revealPage(page);

  const state = await page.evaluate(({ route, playedTracksMode }) => {
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
    const appleRegionRoute = route.mode === 'apple-music' && (!route.panel || route.panel === 'ranks');
    const appleRegionTable = appleRegionRoute ? document.getElementById('appleRegionCompareTable') : null;
    const appleRegionLayout = appleRegionRoute ? (() => {
      const requiredWidth = window.innerWidth <= 640 ? 760 : 820;
      if (!visible(appleRegionTable)) return { ok: false, missing: true, requiredWidth, tableWidth: 0, columnsWidth: 0, wrapperWidth: 0, scrollWidth: 0 };
      const wrapper = appleRegionTable.closest('.apple-region-table-wrap');
      const cells = [...(appleRegionTable.tHead?.rows[0]?.cells || [])];
      const first = cells[0]?.getBoundingClientRect();
      const last = cells.at(-1)?.getBoundingClientRect();
      const tableWidth = appleRegionTable.getBoundingClientRect().width;
      const columnsWidth = first && last ? last.right - first.left : 0;
      const wrapperWidth = wrapper?.clientWidth || 0;
      const scrollWidth = wrapper?.scrollWidth || 0;
      return {
        ok: tableWidth >= requiredWidth - 1 && columnsWidth >= requiredWidth - 1 && scrollWidth >= requiredWidth - 1,
        missing: false, requiredWidth, tableWidth, columnsWidth, wrapperWidth, scrollWidth,
      };
    })() : null;
    return {
      active: location.hash === `#${route.mode}` && source === route.source,
      ariaCurrent: active?.getAttribute('aria-current') || null,
      dataErrors: text.match(/[^。\n]*(?:取得失敗|データの取得に失敗|データを取得できません|materialized response unavailable)[^。\n]*/g) || [],
      visiblePanels,
      horizontalOverflow: Math.max(0, scrollWidth - window.innerWidth),
      appleRegionLayout,
      playlistOverflow: [...document.querySelectorAll('.dashboard-view:not([hidden]) .music-service-playlist-table')]
        .filter(visible)
        .reduce((max, table) => {
          const wrapper = table.closest('.table-wrap');
          return Math.max(max, wrapper ? wrapper.scrollWidth - wrapper.clientWidth : 0);
        }, 0),
      bodyLength: text.length,
      suspicious,
      visibleLoading,
      hash: location.hash,
      title: document.title,
      historyAudit: window.__pagesAuditHistory || null,
      channelHistory: ['past', 'hinata-past'].includes(route.mode) ? (() => {
        const panel = document.querySelector('.dashboard-view:not([hidden])');
        return { rows: Number(panel?.dataset.historyRows || 0), painted: panel?.dataset.historyPainted === 'true' };
      })() : null,
      playedPeriodVisible: ['played-tracks', 'hinata-played-tracks'].includes(route.mode) ? (() => {
        const selected = document.querySelector('.dashboard-view:not([hidden]) .played-tracks-period.is-selected');
        if (!selected) return false;
        const item = selected.getBoundingClientRect(); const strip = selected.closest('.played-tracks-period-scroller').getBoundingClientRect();
        return item.left >= strip.left - 1 && item.right <= strip.right + 1;
      })() : null,
      playedTracksAudit: playedTracksMode ? (() => {
        const panel = document.querySelector('.dashboard-view:not([hidden]) [data-stationhead-panel="played-tracks"]:not([hidden])');
        const total = panel?.querySelector('[data-role="played-total"]')?.textContent?.trim() || '';
        const unique = panel?.querySelector('[data-role="played-unique"]')?.textContent?.trim() || '';
        const body = panel?.querySelector('[data-role="played-tbody"]');
        return {
          selectedDate: panel?.querySelector('.played-tracks-period.is-selected')?.dataset.period || '',
          total, unique, rowCount: body?.children.length || 0,
          empty: (body?.textContent || '').includes('再生履歴データがありません。'),
        };
      })() : null,
      leaderboardAudit: route.mode === 'ranking' ? {
        updatedAt: document.getElementById('leaderboardUpdatedAt')?.textContent?.trim() || '',
        cadence: document.getElementById('leaderboardCadence')?.textContent?.trim() || '',
        tableRows: document.querySelectorAll('#leaderboardTbody tr').length,
        mobileCards: document.getElementById('leaderboardMobileList')?.children.length || 0,
        chartVisible: visible(document.getElementById('leaderboardChart')),
        emptyVisible: visible(document.getElementById('leaderboardChartEmpty')),
      } : null,
      listeningPartyAudit: route.mode === 'broadcasts' ? {
        officialChartPainted: Number(document.getElementById('chart')?.dataset.sakurazakaMaxMinute || 0) > 0,
        officialTableReady: document.getElementById('thead')?.closest('table')?.dataset.officialPartyReadModel === 'complete',
        firstWeekVisible: visible(document.getElementById('firstWeekView')),
        firstWeekChartPainted: Number(document.getElementById('firstWeekChart')?.dataset.firstWeekWidth || 0) > 0,
        firstWeekRows: document.querySelectorAll('#firstWeekTbody tr').length,
        unofficialVisible: visible(document.getElementById('unofficialListeningPanel')),
        unofficialRows: document.querySelectorAll('#unofficialListeningTbody tr').length,
      } : null,
      nogizakaBroadcastAudit: route.mode === 'nogizaka' ? (() => {
        const panel = document.getElementById('nogizakaListeningPartyView');
        const body = panel?.querySelector('[data-role="broadcast-tbody"]');
        const notice = panel?.querySelector('[data-role="notice"]');
        return {
          count: panel?.querySelector('[data-role="broadcast-count"]')?.textContent?.trim() || '',
          rowCount: body?.children.length || 0,
          emptyRow: (body?.textContent || '').includes('リスパデータがありません。'),
          chartVisible: visible(panel?.querySelector('[data-role="broadcast-chart"]')),
          chartEmptyVisible: visible(panel?.querySelector('[data-role="broadcast-chart-empty"]')),
          notice: visible(notice) ? (notice.textContent || '').trim() : '',
        };
      })() : null,
      kkboxAudit: route.kkboxSelection ? (() => {
        const selected = (selector, attribute) => [...document.querySelectorAll(selector)]
          .find((button) => button.getAttribute('aria-pressed') === 'true')
          ?.getAttribute(attribute) || '';
        const chart = document.getElementById('kkboxJapaneseRankChart');
        const body = document.getElementById('kkboxJapaneseHistoryBody');
        return {
          series: selected('[data-kkbox-series-filter]', 'data-kkbox-series-filter'),
          period: selected('[data-kkbox-period-filter]', 'data-kkbox-period-filter'),
          rowCount: body?.children.length || 0,
          chartReady: Boolean(chart && (
            chart.querySelector('canvas, svg, .shared-empty') || (chart.textContent || '').trim()
          )),
        };
      })() : null,
    };
  }, { route: tab, playedTracksMode });

  const name = `${viewport.name}-${String(tab.index + 1).padStart(2, '0')}-${slug(`${tab.mode}${tab.panel ? `-${tab.panel}` : ''}`)}`;
  const screenshot = join(outDir, `${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' });

  const issues = [];
  if (serviceRenderWaitTimedOut) issues.push('music service subview did not finish rendering within 20 seconds');
  if (state.channelHistory && (!state.channelHistory.rows || !state.channelHistory.painted)) issues.push('channel history data or chart was not rendered');
  if (state.playedPeriodVisible === false) issues.push('selected playback period is outside the visible date strip');
  if (playedTracksWaitTimedOut) issues.push('played-tracks data was not rendered within 20 seconds');
  if (playedTracksMode && state.playedTracksAudit && (state.playedTracksAudit.total === '—' || state.playedTracksAudit.unique === '—')) {
    issues.push('played-tracks summary metrics remained placeholders');
  }
  if (playedTracksMode && state.playedTracksAudit?.rowCount === 0) issues.push('played-tracks table has no rows');
  if (historyWaitTimedOut) issues.push('history data or chart was not rendered within 20 seconds');
  if (leaderboardWaitTimedOut) issues.push('leaderboard data was not rendered within 20 seconds');
  if (leaderboardMode && state.leaderboardAudit) {
    const audit = state.leaderboardAudit;
    if (!audit.cadence || audit.cadence === '-') issues.push('leaderboard metadata was not rendered');
    if (audit.tableRows < 1 && audit.mobileCards < 1 && !audit.emptyVisible) issues.push('leaderboard table has no rows');
    if (!audit.chartVisible && !audit.emptyVisible) issues.push('leaderboard chart is hidden');
  }
  if (listeningPartyWaitTimedOut) issues.push('listening party subviews were not fully rendered within 45 seconds');
  if (nogizakaBroadcastWaitTimedOut) issues.push('Nogizaka listening-party data was not rendered within 20 seconds');
  if (kkboxWaitTimedOut) issues.push('KKBOX selected category and period did not finish rendering within 20 seconds');
  if (tab.kkboxSelection && state.kkboxAudit) {
    if (state.kkboxAudit.series !== tab.kkboxSelection.series) issues.push('KKBOX selected category does not match the requested capture state');
    if (state.kkboxAudit.period !== tab.kkboxSelection.period) issues.push('KKBOX selected period does not match the requested capture state');
    if (state.kkboxAudit.rowCount < 1) issues.push('KKBOX history table has no rendered rows or empty state');
    if (!state.kkboxAudit.chartReady) issues.push('KKBOX ranking chart has no rendered state');
  }
  if (nogizakaBroadcastMode && state.nogizakaBroadcastAudit) {
    const audit = state.nogizakaBroadcastAudit;
    if (!audit.count || audit.count === '—') issues.push('Nogizaka listening-party summary metrics remained placeholders');
    if (audit.rowCount < 1) issues.push('Nogizaka listening-party table has no rows');
    if (!audit.chartVisible && !audit.chartEmptyVisible) issues.push('Nogizaka listening-party chart has no rendered state');
    if (audit.notice && /データの取得に失敗|初期化に失敗/.test(audit.notice)) issues.push(`Nogizaka listening-party data error: ${audit.notice}`);
  }
  if (listeningPartyMode && state.listeningPartyAudit) {
    const audit = state.listeningPartyAudit;
    if (!audit.officialChartPainted) issues.push('official listening party chart was not painted');
    if (!audit.officialTableReady) issues.push('official listening party table was not rendered');
    if (!audit.firstWeekVisible) issues.push('first-week comparison panel is hidden');
    if (!audit.firstWeekChartPainted) issues.push('first-week comparison chart was not painted');
    if (audit.firstWeekRows < 1) issues.push('first-week comparison table has no rows');
    if (!audit.unofficialVisible) issues.push('unofficial listening party panel is hidden');
    if (audit.unofficialRows < 1) issues.push('unofficial listening party table has no rows');
  }
  if (historyMode && state.historyAudit?.mode === tab.mode && state.historyAudit.rowCount === 0) {
    issues.push('history summary returned no rows for the full available period');
  }
  if (!state.active) issues.push('selected tab is not marked active');
  if (state.visiblePanels.length !== 1) issues.push(`expected exactly one visible dashboard view, got ${state.visiblePanels.length}`);
  if (state.horizontalOverflow > 1) issues.push(`document horizontally overflows by ${state.horizontalOverflow}px`);
  if (state.playlistOverflow > 3) issues.push(`playlist table is horizontally clipped by ${state.playlistOverflow}px`);
  if (state.appleRegionLayout && !state.appleRegionLayout.ok) {
    issues.push(`Apple Music regional table is compressed or not fully scrollable: ${JSON.stringify(state.appleRegionLayout)}`);
  }
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
      const routeStates = tab.mode === 'kkbox' ? kkboxAuditRoutes(tab) : [tab];
      for (const routeState of routeStates) {
        views.push(await inspectView(page, routeState, viewport, outDir));
      }
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
const dataAudit = await auditPagesData(async (path) => {
  const response = await fetch(`${options.url}${path}`, { signal: AbortSignal.timeout(30_000), headers: { 'cache-control': 'no-cache' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
});
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
  dataAudit,
  summary: {
    screenshotCount: allViews.length,
    failedViewCount: allViews.filter((view) => !view.ok).length,
    consoleErrorCount: results.reduce((sum, result) => sum + result.consoleErrors.length, 0),
    pageErrorCount: results.reduce((sum, result) => sum + result.pageErrors.length, 0),
    requestFailureCount: results.reduce((sum, result) => sum + result.requestFailures.length, 0),
    dataFailureCount: dataAudit.failed_count,
  },
  fatal,
};

await writeFile(join(options.outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.summary));
console.log(JSON.stringify({ event: 'pages_data_audit', checks: dataAudit.checks }));

const issueCount = report.summary.failedViewCount
  + report.summary.consoleErrorCount
  + report.summary.pageErrorCount
  + report.summary.requestFailureCount;
const totalIssueCount = issueCount + report.summary.dataFailureCount;
if (fatal || totalIssueCount > 0) {
  if (fatal) console.error(fatal);
  if (issueCount > 0) console.error(`Visual audit detected ${issueCount} issue(s).`);
  process.exitCode = 1;
}

}

if (import.meta.url === `file://${process.argv[1]}`) await runVisualAudit();

