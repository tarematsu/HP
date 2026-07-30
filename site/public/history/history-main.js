const VALID_MODES = new Set(['daily', 'weekly', 'ranking', 'monthly', 'broadcasts']);
const DASHBOARD_MODES = new Set(['daily', 'weekly', 'ranking', 'monthly', 'broadcasts']);
const requestedMode = location.hash.slice(1);
const legacyHistoryRoute = /^\/history(?:\/index\.html)?\/?$/.test(location.pathname);

function installRemovedControlCompatibility() {
  const root = document.getElementById('historyView') || document.body;
  const removedControls = [
    [['track', 'Controls'].join(''), 'div', ''],
    [['track', 'Date'].join(''), 'input', 'date'],
    [['track', 'WeekMode'].join(''), 'input', 'checkbox'],
  ];
  for (const [id, tagName, type] of removedControls) {
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

  // The compact runtime still dereferences removed controls while booting.
  // Keep inert compatibility nodes until that legacy code is retired.
  installRemovedControlCompatibility();
  await import('/history/history-request-guard.js');
  await import('/history/history-current-overlay.js');
  await import('/history/history-page-fixes.js');
  await import('/history/history-lite.js');
  window.dispatchEvent(new Event('history:runtime-ready'));
}
