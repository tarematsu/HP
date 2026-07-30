const VALID_MODES = new Set(['daily', 'weekly', 'ranking', 'monthly', 'broadcasts']);
const DASHBOARD_MODES = new Set(['daily', 'weekly', 'ranking', 'monthly', 'broadcasts']);
const requestedMode = location.hash.slice(1);
const legacyHistoryRoute = /^\/history(?:\/index\.html)?\/?$/.test(location.pathname);

if (legacyHistoryRoute) {
  const dashboardMode = DASHBOARD_MODES.has(requestedMode) ? requestedMode : 'weekly';
  location.replace(`/#${dashboardMode}`);
} else {
  if (!VALID_MODES.has(requestedMode)) {
    history.replaceState(null, '', '#weekly');
  }

  await import('/history/history-request-guard.js');
  await import('/history/history-current-overlay.js');
  await import('/history/history-page-fixes.js');
  await import('/history/history-lite.js');
  window.dispatchEvent(new Event('history:runtime-ready'));
}
