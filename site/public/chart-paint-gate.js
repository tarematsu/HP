export function createChartPaintGate(node, {
  pendingKey = 'paintPending',
  stableKey = 'paintStable',
  fallbackMs = 0,
  oneShot = false,
} = {}) {
  let armed = false;
  let settled = false;
  let revealTimer = 0;
  let fallbackTimer = 0;

  function clearTimers() {
    clearTimeout(revealTimer);
    clearTimeout(fallbackTimer);
    revealTimer = 0;
    fallbackTimer = 0;
  }

  function applyVisible(stable) {
    if (!node) return;
    node.style.opacity = '1';
    node.style.pointerEvents = '';
    delete node.dataset[pendingKey];
    if (stable) node.dataset[stableKey] = 'true';
    else delete node.dataset[stableKey];
  }

  function conceal() {
    if (!node || (oneShot && settled)) return false;
    armed = true;
    clearTimers();
    node.style.opacity = '0';
    node.style.pointerEvents = 'none';
    node.dataset[pendingKey] = 'true';
    delete node.dataset[stableKey];
    if (fallbackMs > 0) fallbackTimer = setTimeout(() => reveal(0), fallbackMs);
    return true;
  }

  function reveal(delay = 0) {
    if (!node || !armed || (oneShot && settled)) return;
    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!armed || (oneShot && settled)) return;
        armed = false;
        settled = true;
        clearTimeout(fallbackTimer);
        fallbackTimer = 0;
        applyVisible(true);
      }));
    }, Math.max(0, Number(delay) || 0));
  }

  function show({ stable = false } = {}) {
    if (!node) return;
    clearTimers();
    armed = false;
    if (stable) settled = true;
    applyVisible(stable);
  }

  function isStable() {
    return Boolean(node?.dataset?.[stableKey] === 'true' && node.style.opacity !== '0');
  }

  return {
    conceal,
    reveal,
    show,
    isStable,
    clearTimers,
  };
}
