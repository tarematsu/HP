LR"JS(
(() => {
  const entered = !!(
      document.fullscreenElement || document.webkitFullscreenElement ||
      document.msFullscreenElement);
  const state = window.__homePanelTverRuntime;
  if (entered && state) state.fullscreenKeyRequestedAt = 0;
  try { window.chrome?.webview?.postMessage('homepanel:tver-wake'); }
  catch (_) {}
  return entered;
})()
)JS"