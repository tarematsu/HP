const VALID_MODES = new Set(['daily', 'weekly', 'ranking', 'monthly', 'broadcasts']);
const requestedMode = location.hash.slice(1);

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

if (!VALID_MODES.has(requestedMode)) {
  history.replaceState(null, '', '/#weekly');
}

// The compact runtime still dereferences removed controls while booting.
// Keep inert compatibility nodes until that legacy code is retired.
installRemovedControlCompatibility();
await import('/history/history-request-guard.js?v=20260921.2');
await import('/history/history-current-overlay.js');
await import('/history/history-page-fixes.js');
await import('/history/history-axis-labels.js?v=20260922.2');
await import('/history/history-period-chart.js?v=20260921.1');
await import('/history/history-ranking-chart.js?v=20260923.2');
await import('/history/history-ranking-missing-gap.js?v=20260923.2');
await import('/history/history-table-cleanup.js?v=20260921.2');
await import('/history/history-broadcast-summary.js?v=20260921.1');
await import('/history/history-lite.js');
window.dispatchEvent(new Event('history:runtime-ready'));