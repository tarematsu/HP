namespace hp {
namespace {

constexpr wchar_t kSpotifyAuthenticationBadgeBootstrapScript[] = LR"JS(
(() => {
  const mountBadge = text => {
    if (!text) return;
    let badge = document.getElementById('__homePanelSpotifyAccount');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = '__homePanelSpotifyAccount';
      badge.style.cssText =
          'position:fixed;left:8px;top:8px;z-index:2147483647;' +
          'padding:4px 7px;border-radius:4px;background:rgba(0,0,0,.78);' +
          'color:#fff;font:600 14px/1.2 "Segoe UI",sans-serif;' +
          'pointer-events:none;';
      (document.body || document.documentElement).appendChild(badge);
    }
    badge.textContent = text;
  };

  if (!window.__homePanelSpotifyAuthenticationBadgeBridgeInstalled) {
    window.__homePanelSpotifyAuthenticationBadgeBridgeInstalled = true;
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.addEventListener('message', event => {
        if (typeof event.data !== 'string') return;
        const fields = event.data.split('\u001f');
        if (fields[0] === 'spotify:account') mountBadge(fields[1] || '');
      });
    }
  }
  return true;
})()
)JS";

}  // namespace
}  // namespace hp
