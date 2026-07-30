const VALID_MODES = new Set(['daily', 'weekly', 'ranking', 'monthly', 'broadcasts']);
const DASHBOARD_MODES = new Set(['daily', 'weekly', 'ranking', 'monthly', 'broadcasts']);
const requestedMode = location.hash.slice(1);
const legacyHistoryRoute = /^\/history(?:\/index\.html)?\/?$/.test(location.pathname);

function installRemovedTrackControlCompatibility() {
  const root = document.getElementById('historyView') || document.body;
  for (const [id, tagName, type] of [
    ['trackControls', 'div', ''],
    ['trackDate', 'input', 'date'],
    ['trackWeekMode', 'input', 'checkbox'],
  ]) {
    if (document.getElementById(id)) continue;
    const node = document.createElement(tagName);
    node.id = id;
    node.hidden = true;
    node.setAttribute('aria-hidden', 'true');
    if (type) node.type = type;
    root.append(node);
  }
}

if (legacyHistoryRoute) {
  const dashboardMode = DASHBOARD_MODES.has(requestedMode) ? requestedMode : 'weekly';
  location.replace(`/#${dashboardMode}`);
} else {
  if (!VALID_MODES.has(requestedMode)) {
    history.replaceState(null, '', '#weekly');
  }

  // The compact runtime still dereferences the removed track controls while
  // booting. Keep inert compatibility nodes until that legacy code is retired.
  installRemovedTrackControlCompatibility();
  await import('/history/history-request-guard.js');
  await import('/history/history-current-overlay.js');
  await import('/history/history-page-fixes.js');
  await import('/history/history-lite.js');
  window.dispatchEvent(new Event('history:runtime-ready'));
}
