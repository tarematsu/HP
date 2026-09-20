const stylesheetHref = '/dashboard-fixes.css?v=20260919.3';
if (!document.querySelector(`link[href="${stylesheetHref}"]`)) {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = stylesheetHref;
  document.head.append(stylesheet);
}

const monochromeStylesheetHref = '/monochrome.css?v=20260919.3';
if (!document.querySelector(`link[href="${monochromeStylesheetHref}"]`)) {
  const monochromeStylesheet = document.createElement('link');
  monochromeStylesheet.rel = 'stylesheet';
  monochromeStylesheet.href = monochromeStylesheetHref;
  document.head.append(monochromeStylesheet);
}

const screenshotCleanupHref = '/screenshot-audit-cleanup.css?v=20260919.3';
if (!document.querySelector(`link[href="${screenshotCleanupHref}"]`)) {
  const screenshotCleanup = document.createElement('link');
  screenshotCleanup.rel = 'stylesheet';
  screenshotCleanup.href = screenshotCleanupHref;
  document.head.append(screenshotCleanup);
}

const periodDisplayFixesHref = '/period-display-fixes.css?v=20260921.1';
if (!document.querySelector(`link[href="${periodDisplayFixesHref}"]`)) {
  const periodDisplayFixes = document.createElement('link');
  periodDisplayFixes.rel = 'stylesheet';
  periodDisplayFixes.href = periodDisplayFixesHref;
  document.head.append(periodDisplayFixes);
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

const JST_DATE_TIME = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const UTC_UPDATED_PATTERN = /^最終取得\s+(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s+UTC(.*)$/;
function updatedLabelInJst(value) {
  const text = String(value || '');
  if (text === '最終取得 — UTC') return '最終取得 — JST';
  const match = text.match(UTC_UPDATED_PATTERN);
  if (!match) return text;
  const [, month, day, hour, minute, second, suffix] = match;
  const now = Date.now();
  const currentYear = new Date(now).getUTCFullYear();
  let year = currentYear;
  let timestamp = Date.UTC(year, Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  const HALF_YEAR_MS = 183 * 86_400_000;
  if (timestamp - now > HALF_YEAR_MS) year -= 1;
  else if (now - timestamp > HALF_YEAR_MS) year += 1;
  timestamp = Date.UTC(year, Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  return `最終取得 ${JST_DATE_TIME.format(new Date(timestamp))} JST${suffix}`;
}

const description = document.getElementById('description');
const updated = document.getElementById('updated');
function normalizeUpdatedLabel() {
  if (!updated) return;
  const next = updatedLabelInJst(updated.textContent);
  if (next !== updated.textContent) updated.textContent = next;
}
if (updated) {
  updated.className = 'subtle';
  if (description) description.replaceWith(updated);
  normalizeUpdatedLabel();
  new MutationObserver(normalizeUpdatedLabel).observe(updated, {
    childList: true,
    subtree: true,
    characterData: true,
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
