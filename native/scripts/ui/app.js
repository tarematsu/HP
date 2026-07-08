(() => {
  'use strict';

  const root = window.HomePanel;
  const { loadTexts, setStaticLabels } = root.utils;
  const panels = root.panels || {};
  const runtime = root.runtime || {};

  function renderRuntime(state) {
    runtime.renderRuntime?.(state || {});
  }

  async function initialize() {
    let initialized = false;
    let queuedState = null;

    if (window.chrome?.webview) {
      window.chrome.webview.addEventListener('message', event => {
        if (!initialized) {
          queuedState = event.data;
          return;
        }
        renderRuntime(event.data);
      });
    }

    await loadTexts();
    setStaticLabels();
    panels.energy?.drawEnergyChart();

    initialized = true;
    if (queuedState) renderRuntime(queuedState);
    window.chrome?.webview?.postMessage({ type: 'ready' });

    window.addEventListener('resize', () => {
      panels.energy?.drawEnergyChart();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        panels.energy?.drawEnergyChart();
      }
    });
  }

  initialize();
})();
