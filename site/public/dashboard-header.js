const stylesheetHref = '/dashboard-fixes.css?v=20260922.3';
if (!document.querySelector(`link[href="${stylesheetHref}"]`)) {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = stylesheetHref;
  document.head.append(stylesheet);
}

const screenshotCleanupHref = '/screenshot-audit-cleanup.css?v=20260919.3';
if (!document.querySelector(`link[href="${screenshotCleanupHref}"]`)) {
  const screenshotCleanup = document.createElement('link');
  screenshotCleanup.rel = 'stylesheet';
  screenshotCleanup.href = screenshotCleanupHref;
  document.head.append(screenshotCleanup);
}

const periodDisplayFixesHref = '/period-display-fixes.css?v=20260921.4';
if (!document.querySelector(`link[href="${periodDisplayFixesHref}"]`)) {
  const periodDisplayFixes = document.createElement('link');
  periodDisplayFixes.rel = 'stylesheet';
  periodDisplayFixes.href = periodDisplayFixesHref;
  document.head.append(periodDisplayFixes);
}

const currentEnhancementsHref = '/dashboard-current-enhancements.css?v=20260921.4';
if (!document.querySelector(`link[href="${currentEnhancementsHref}"]`)) {
  const currentEnhancements = document.createElement('link');
  currentEnhancements.rel = 'stylesheet';
  currentEnhancements.href = currentEnhancementsHref;
  document.head.append(currentEnhancements);
}

const layoutUnificationHref = '/pages-layout-unification.css?v=20260921.1';
if (!document.querySelector(`link[href="${layoutUnificationHref}"]`)) {
  const layoutUnification = document.createElement('link');
  layoutUnification.rel = 'stylesheet';
  layoutUnification.href = layoutUnificationHref;
  document.head.append(layoutUnification);
}

const layoutFinalFixesHref = '/pages-layout-final-fixes.css?v=20260922.2';
if (!document.querySelector(`link[href="${layoutFinalFixesHref}"]`)) {
  const layoutFinalFixes = document.createElement('link');
  layoutFinalFixes.rel = 'stylesheet';
  layoutFinalFixes.href = layoutFinalFixesHref;
  document.head.append(layoutFinalFixes);
}

const KEYBOARD_NAVIGATION_CLASS = 'keyboard-navigation';
const skipLink = document.querySelector('.skip-link');
const clearKeyboardNavigation = () => {
  document.documentElement.classList.remove(KEYBOARD_NAVIGATION_CLASS);
};
const releaseProgrammaticSkipLinkFocus = () => {
  if (
    document.activeElement === skipLink
    && !document.documentElement.classList.contains(KEYBOARD_NAVIGATION_CLASS)
  ) skipLink?.blur();
};
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab' || !event.isTrusted) return;
  document.documentElement.classList.add(KEYBOARD_NAVIGATION_CLASS);
  setTimeout(() => {
    if (document.activeElement !== skipLink) clearKeyboardNavigation();
  }, 0);
}, { capture: true });
skipLink?.addEventListener('focus', releaseProgrammaticSkipLinkFocus);
queueMicrotask(releaseProgrammaticSkipLinkFocus);
document.addEventListener('focusout', (event) => {
  if (event.target === skipLink) clearKeyboardNavigation();
}, { capture: true });
document.addEventListener('pointerdown', clearKeyboardNavigation, { capture: true });

const DASHBOARD_TITLE = '#櫻坂46_ステへ統計';
document.title = DASHBOARD_TITLE;
const DASHBOARD_TITLE_SEARCH_URL = `https://x.com/search?q=${encodeURIComponent(DASHBOARD_TITLE)}&src=typed_query`;
const channelName = document.getElementById('channelName');
function renderDashboardTitle() {
  if (!channelName) return;
  const existing = channelName.querySelector('a[data-dashboard-title-link]');
  if (existing && channelName.childNodes.length === 1 && existing.textContent === DASHBOARD_TITLE) return;
  const link = document.createElement('a');
  link.dataset.dashboardTitleLink = 'true';
  link.href = DASHBOARD_TITLE_SEARCH_URL;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = DASHBOARD_TITLE;
  link.style.color = 'inherit';
  link.style.textDecoration = 'none';
  channelName.replaceChildren(link);
}
renderDashboardTitle();
if (channelName) {
  new MutationObserver(renderDashboardTitle).observe(channelName, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

const JST_TIME = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const DASHBOARD_MATERIALIZED_AT_CACHE_KEY = 'sh.dashboard.materialized-at.v1';

function cachedDashboardMaterializedAt() {
  try {
    const value = Number(localStorage.getItem(DASHBOARD_MATERIALIZED_AT_CACHE_KEY));
    if (!Number.isFinite(value) || value <= 0 || value > Date.now() + 5 * 60_000) return null;
    return value;
  } catch {
    return null;
  }
}

function cacheDashboardMaterializedAt(value) {
  try {
    localStorage.setItem(DASHBOARD_MATERIALIZED_AT_CACHE_KEY, String(value));
  } catch {
    // Storage can be unavailable in restricted browser modes.
  }
}

let dashboardMaterializedAt = cachedDashboardMaterializedAt();
let renderingUpdatedLabel = false;

const description = document.getElementById('description');
const updated = document.getElementById('updated');
function renderUpdatedLabel() {
  if (!updated || renderingUpdatedLabel) return;
  const refreshText = dashboardMaterializedAt == null ? '—' : JST_TIME.format(new Date(dashboardMaterializedAt));
  const next = `更新 ${refreshText} (5分毎)`;
  if (next === updated.textContent) return;
  renderingUpdatedLabel = true;
  updated.textContent = next;
  updated.title = `更新 ${refreshText} JST (5分毎)`;
  updated.setAttribute('aria-label', updated.title);
  renderingUpdatedLabel = false;
}

function setDashboardMaterializedAt(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > Date.now() + 5 * 60_000) return;
  dashboardMaterializedAt = timestamp;
  cacheDashboardMaterializedAt(timestamp);
  renderUpdatedLabel();
}

if (updated) {
  updated.className = 'subtle';
  if (description) description.replaceWith(updated);
  renderUpdatedLabel();
  new MutationObserver(renderUpdatedLabel).observe(updated, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  window.addEventListener('dashboard:materialized-at', (event) => {
    setDashboardMaterializedAt(event?.detail?.updatedAt);
  });
}
description?.remove();

document.querySelector('.live-line')?.remove();
document.querySelector('.app-launch')?.remove();

const actions = document.querySelector('.dashboard-actions');
const tabs = document.getElementById('modeTabs');
if (actions && tabs) actions.replaceWith(tabs);

const broadcastsTab = document.querySelector('#modeTabs [data-mode="broadcasts"]');
if (broadcastsTab) broadcastsTab.textContent = '公式リスパ';

for (const id of ['currentChartDetail', 'chartDetail', 'notice']) {
  const element = document.getElementById(id);
  if (element) element.textContent = '';
}
