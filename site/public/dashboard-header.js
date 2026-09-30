import { byId } from './dashboard-ui-common.js?v=20260930.1';

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
const updated = byId('updated');

function renderUpdatedLabel() {
  if (!updated) return;
  const refreshText = dashboardMaterializedAt == null ? '—' : JST_TIME.format(new Date(dashboardMaterializedAt));
  const next = `更新 ${refreshText}`;
  if (next === updated.textContent) return;
  updated.textContent = next;
  updated.title = `更新 ${refreshText} JST`;
  updated.setAttribute('aria-label', updated.title);
}

function setDashboardMaterializedAt(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > Date.now() + 5 * 60_000) return;
  dashboardMaterializedAt = timestamp;
  cacheDashboardMaterializedAt(timestamp);
  renderUpdatedLabel();
}

renderUpdatedLabel();
window.addEventListener('dashboard:materialized-at', (event) => {
  setDashboardMaterializedAt(event?.detail?.updatedAt);
});
