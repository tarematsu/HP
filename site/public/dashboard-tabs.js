import { ensureDashboardSectionStyles } from './dashboard-styles.js?v=20261005.2';
import { bindRovingTabs, syncRovingTabs } from './dashboard-roving-tabs.js';
import { HISTORY_MODES, NAVIGATION, VIEW_IDS, VIEW_MODES, navigationForMode, routeForMode, sourceById } from './dashboard-navigation-config.js';
import { loadDashboardModuleOnce as loadOnce, showDashboardRuntimeError as showRuntimeError } from './dashboard-view-loader.js';

const sectionTabs = document.getElementById('sectionTabs');
const sourceTabs = document.getElementById('sourceTabs');
const functionTabs = document.getElementById('functionTabs');
const skipLink = document.querySelector('.skip-link');
const lastSourceBySection = new Map(NAVIGATION.map((section) => [section.id, section.sources[0]?.id || '']));
const lastModeBySource = new Map();
let historyRuntimeMode = null;
let activeMode = 'current';
let initialRouteReady = false;

const DASHBOARD_ROUTE_MODULES = Object.freeze({
  hinata: Object.freeze({
    shell: () => import('/hinata-shell.js?v=20261001.2'),
    runtime: () => import('/hinata.js?v=20260930.5'),
  }),
  ranking: Object.freeze({
    shell: () => import('/leaderboard-shell.js?v=20261005.2'),
    runtime: () => import('/leaderboard.js?v=20261005.2'),
  }),
  followers: Object.freeze({
    shell: () => import('/followers-shell.js?v=20261005.2'),
    runtime: () => import('/followers.js?v=20261005.2'),
  }),
  spotify: Object.freeze({
    shell: () => import('/spotify-shell.js?v=20261004.1'),
    runtime: () => import('/spotify.js?v=20261004.1'),
  }),
  'amazon-music': Object.freeze({
    shell: () => import('/amazon-music-shell.js?v=20261004.1'),
    runtime: () => import('/amazon-music.js?v=20261004.1'),
  }),
  'apple-music': Object.freeze({
    shell: () => import('/apple-music-shell.js?v=20261004.1'),
    runtime: () => import('/apple-music.js?v=20261001.1'),
  }),
  'youtube-music': Object.freeze({
    shell: () => import('/youtube-music-shell.js?v=20261003.4'),
    runtime: () => import('/youtube-music.js?v=20261004.2'),
  }),
  kkbox: Object.freeze({
    shell: () => import('/kkbox-shell.js?v=20261004.1'),
    runtime: () => import('/kkbox.js?v=20261004.1'),
  }),
  qq_music: Object.freeze({
    shell: () => import('/qq-music-shell.js?v=20261004.1'),
    runtime: () => import('/qq-music.js?v=20261004.1'),
  }),
  kugou_music: Object.freeze({
    shell: () => import('/kugou-music-shell.js?v=20261004.1'),
    runtime: () => import('/kugou-music.js?v=20261004.1'),
  }),
  nogizaka: Object.freeze({
    shell: () => import('/nogizaka-listening-party-shell.js?v=20261003.1'),
    runtime: () => import('/nogizaka-listening-party.js?v=20260930.1'),
  }),
});

function lazyRouteModules(route) {
  const modules = DASHBOARD_ROUTE_MODULES[route?.moduleId];
  if (!modules) throw new Error(`missing dashboard route modules: ${route?.moduleId || 'unknown'}`);
  return modules;
}

for (const section of NAVIGATION) for (const source of section.sources) lastModeBySource.set(source.id, source.defaultMode);

function ensureModeStyles(mode) {
  if (mode === 'current') return Promise.resolve();
  return ensureDashboardSectionStyles(navigationForMode(mode)?.section.id);
}
function releaseUnexpectedSkipLinkFocus() {
  if (document.activeElement === skipLink) skipLink?.blur();
  document.documentElement.classList.remove('keyboard-navigation');
}
function markRouteReady() {
  if (initialRouteReady) return;
  initialRouteReady = true;
  window.dispatchEvent(new Event('dashboard:route-ready'));
}
function renderFunctionTabs(source, mode) {
  if (!functionTabs) return;
  functionTabs.replaceChildren();
  const items = source?.functions || [];
  functionTabs.hidden = items.length <= 1;
  if (items.length <= 1) return;
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.mode = item.mode; button.textContent = item.label;
    const selected = item.mode === mode;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    functionTabs.append(button);
  }
  syncRovingTabs(functionTabs, functionTabs.querySelector('.active'));
}
function renderSourceTabs(section, activeSource) {
  if (!sourceTabs) return;
  const fragment = document.createDocumentFragment();
  for (const source of section.sources) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.source = source.id; button.textContent = source.label;
    const selected = source.id === activeSource.id;
    button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected)); fragment.append(button);
  }
  sourceTabs.classList.toggle('is-multiline', section.id === 'subscriptions');
  sourceTabs.replaceChildren(fragment); sourceTabs.hidden = false;
  syncRovingTabs(sourceTabs, sourceTabs.querySelector('.active'));
  let select = document.getElementById('sourceSelect');
  if (!select) {
    const label = document.createElement('label');
    label.className = 'dashboard-source-picker'; label.htmlFor = 'sourceSelect'; label.append('表示対象');
    select = document.createElement('select'); select.id = 'sourceSelect'; label.append(select); sourceTabs.after(label);
    select.addEventListener('change', () => {
      const source = sourceById(navigationForMode(activeMode)?.section, select.value);
      if (source) activateMode(lastModeBySource.get(source.id) || source.defaultMode);
    });
  }
  select.replaceChildren(...section.sources.map((source) => {
    const option = document.createElement('option'); option.value = source.id; option.textContent = source.label; option.selected = source.id === activeSource.id; return option;
  }));
}
function syncNavigation(mode) {
  if (!sectionTabs || !sourceTabs) return;
  const navigation = navigationForMode(mode); if (!navigation) return;
  const { section, source } = navigation;
  lastSourceBySection.set(section.id, source.id); lastModeBySource.set(source.id, mode);
  sectionTabs.querySelectorAll('button[data-section]').forEach((button) => {
    const selected = button.dataset.section === section.id;
    button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected));
  });
  syncRovingTabs(sectionTabs, sectionTabs.querySelector('.active'));
  renderSourceTabs(section, source); renderFunctionTabs(source, mode);
}
function updateLocation(mode, { replace = false } = {}) {
  const target = mode === 'current' ? '/' : `/#${mode}`;
  const current = `${location.pathname}${location.search}${location.hash}`;
  if (current === target) return;
  const oldURL = location.href;
  history[replace ? 'replaceState' : 'pushState'](null, '', target);
  if (oldURL !== location.href) window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: location.href }));
}
function showOnly(view) {
  for (const id of VIEW_IDS) { const node = document.getElementById(id); if (node) node.hidden = node !== view; }
}
function setRoute(mode, view, { updateUrl = true, replaceUrl = false } = {}) {
  activeMode = mode; document.getElementById('routeError')?.remove(); showOnly(view); syncNavigation(mode);
  if (updateUrl) updateLocation(mode, { replace: replaceUrl });
}

async function showStationheadPanel(mode, route, options = {}) {
  setRoute(mode, null, options);
  try {
    await Promise.all([ensureModeStyles(mode), loadOnce('current:shell', () => import('/current-shell.js?v=20261005.2'))]);
    if (activeMode !== mode) return;
    const view = document.getElementById(route.viewId); showOnly(view); markRouteReady();
    const runtime = await loadOnce('current:runtime', () => import('/stationhead-channel.js?v=20261005.4'));
    if (activeMode !== mode) return;
    await runtime.selectStationheadChannelSection?.(view, route.panel);
    if (activeMode === mode) await runtime.loadStationheadChannelView(view);
  } catch (error) {
    if (activeMode !== mode) return; markRouteReady();
    showRuntimeError({ errorLabel: mode, errorMessage: '画面の初期化に失敗しました。再読み込みしてください。' }, error);
  } finally { releaseUnexpectedSkipLinkFocus(); }
}
async function showLazyView(mode, route, options = {}) {
  setRoute(mode, null, options);
  const modules = lazyRouteModules(route);
  try {
    await Promise.all([ensureModeStyles(mode), loadOnce(`${mode}:shell`, modules.shell)]);
    if (activeMode !== mode) return;
    showOnly(document.getElementById(route.viewId)); markRouteReady();
    const runtime = await loadOnce(`${mode}:runtime`, modules.runtime);
    if (activeMode !== mode) return;
    if (route.loadExport) await runtime[route.loadExport]?.(route.loadArgs || undefined);
  } catch (error) {
    if (activeMode !== mode) return; markRouteReady(); showRuntimeError(route, error);
  } finally { releaseUnexpectedSkipLinkFocus(); }
}
async function showHistory(mode, route, { updateUrl = true, replaceUrl = false, syncRuntime = true } = {}) {
  if (!HISTORY_MODES.has(mode)) return showMode('current', { updateUrl, replaceUrl });
  setRoute(mode, null, { updateUrl, replaceUrl });
  try {
    await Promise.all([ensureModeStyles(mode), loadOnce('history:shell', () => import('/history-shell.js?v=20260930.1'))]);
    if (activeMode !== mode) return;
    if (route.firstWeek) {
      await Promise.all([
        loadOnce('first-week:shell', () => import('/first-week-comparison-shell.js?v=20261002.2')),
        loadOnce('first-week:runtime', () => import('/first-week-comparison.js?v=20261002.2')),
      ]);
      if (activeMode !== mode) return;
    }
    await loadOnce('history:runtime', () => import('/history/history-main.js?v=20261002.4'));
    if (activeMode !== mode) return;
    if (syncRuntime && historyRuntimeMode !== mode) window.dispatchEvent(new CustomEvent('history:select-mode', { detail: { mode } }));
    historyRuntimeMode = mode; showOnly(document.getElementById(route.viewId)); markRouteReady();
  } catch (error) {
    if (activeMode !== mode) return;
    historyRuntimeMode = null; showOnly(document.getElementById(route.viewId)); markRouteReady();
    showRuntimeError({ noticeId: 'notice', errorLabel: 'history', errorMessage: '過去データの初期化に失敗しました。再読み込みしてください。' }, error);
  } finally { releaseUnexpectedSkipLinkFocus(); }
}
function modeFromLocation() {
  const mode = location.hash.slice(1);
  if (mode === 'first-week' || mode === 'unofficial') { history.replaceState(null, '', `${location.pathname}${location.search}#broadcasts`); return 'broadcasts'; }
  return VIEW_MODES.has(mode) ? mode : 'current';
}
function showMode(mode, options = {}) {
  const route = routeForMode(mode);
  if (route.kind === 'stationhead') void showStationheadPanel(mode, route, options);
  else if (route.kind === 'history') void showHistory(mode, route, options);
  else void showLazyView(mode, route, options);
}
function activateMode(mode) { const target = String(mode || ''); if (VIEW_MODES.has(target)) showMode(target); }
function syncFromLocation() { const mode = modeFromLocation(); if (mode !== activeMode) showMode(mode, { updateUrl: false }); }

sectionTabs?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-section]'); if (!button || !sectionTabs.contains(button)) return;
  const section = NAVIGATION.find((item) => item.id === button.dataset.section); if (!section) return;
  const source = sourceById(section, lastSourceBySection.get(section.id)); if (source) activateMode(lastModeBySource.get(source.id) || source.defaultMode);
});
sourceTabs?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-source]'); if (!button || !sourceTabs.contains(button)) return;
  const source = sourceById(navigationForMode(activeMode)?.section, button.dataset.source); if (source) activateMode(lastModeBySource.get(source.id) || source.defaultMode);
});
functionTabs?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-mode]'); if (!button || !functionTabs.contains(button)) return; activateMode(button.dataset.mode);
});
bindRovingTabs(sectionTabs, (button) => button.click());
bindRovingTabs(sourceTabs, (button) => button.click());
bindRovingTabs(functionTabs, (button) => button.click());
window.addEventListener('popstate', syncFromLocation); window.addEventListener('hashchange', syncFromLocation);
const initialMode = modeFromLocation();
showMode(initialMode, { updateUrl: initialMode === 'current' && Boolean(location.hash), replaceUrl: true, syncRuntime: false });
