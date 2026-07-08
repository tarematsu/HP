(() => {
  'use strict';

  // All dashboard panels are rendered natively; the page only hosts the
  // wallpaper backdrop and acknowledges the WebView bridge.
  window.chrome?.webview?.postMessage({ type: 'ready' });
})();
