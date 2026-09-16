namespace hp {
namespace {

constexpr wchar_t kSpotifyMessageSeparator = L'\x1f';
constexpr std::array<std::wstring_view, kSpotifyActiveAccountCount> kSpotifyPanelNames = {
    L"yuukiar", L"ten", L"nagi", L"hinata"};

constexpr wchar_t kSpotifyStaticPageBootstrapScript[] = LR"JS(
(() => {
  window.__homePanelSpotifyGeneration =
      window.__homePanelSpotifyGeneration || '0';
  // NavigationCompleted installs this bootstrap. Remember that moment so the
  // first trusted Play click cannot race Spotify's post-load player startup.
  // Date.now() is also available in the lightweight VM contract harness.
  window.__homePanelSpotifyNativeLoadedAt = Date.now();

  if (window.__homePanelSpotifyStaticBridgeInstalled) return true;
  window.__homePanelSpotifyStaticBridgeInstalled = true;
  window.__homePanelSpotifyNativeTarget = null;

  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener('message', event => {
      if (typeof event.data !== 'string') return;
      const fields = event.data.split('\u001f');
      if (fields[0] === 'spotify:generation') {
        window.__homePanelSpotifyGeneration = fields[1] || '0';
        return;
      }
      if (fields[0] !== 'spotify:target') return;

      const path = fields[1] || '';
      window.__homePanelSpotifyNativeTarget = path ? {
        path,
        title: (fields[2] || '').replace(/\s+/g, ' ').trim().toLowerCase()
      } : null;
    });
  }
  return true;
})()
)JS";

// Prefer Spotify's own SPA link when the next managed track is already present
// in the current React tree. Clicking that real link lets Spotify's router keep
// the app shell alive. Native falls back to a top-level Navigate when no exact
// link is available, so this optimization never makes routing mandatory.
constexpr wchar_t kSpotifySpaRouteScript[] = LR"JS(
(() => {
  const target = window.__homePanelSpotifyNativeTarget;
  const targetPath = target && (target.path || target.trackPath || target.pagePath || '');
  if (!targetPath || location.hostname !== 'open.spotify.com') return false;
  if (location.pathname === targetPath ||
      (targetPath.startsWith('/track/') && location.pathname.endsWith(targetPath))) {
    return true;
  }

  const links = Array.from(document.querySelectorAll('a[href*="/track/"]'));
  const link = links.find(candidate => {
    try {
      const url = new URL(candidate.href, location.href);
      return url.origin === location.origin &&
          (url.pathname === targetPath ||
           (targetPath.startsWith('/track/') && url.pathname.endsWith(targetPath)));
    } catch (_) {
      return false;
    }
  });
  if (!link || !link.isConnected) return false;

  try {
    link.click();
    return true;
  } catch (_) {
    return false;
  }
})()
)JS";

}  // namespace

std::array<SpotifyPlaybackStatus, kSpotifyActiveAccountCount>
SpotifyWebViews::PlaybackStatuses() const noexcept {
  std::array<SpotifyPlaybackStatus, kSpotifyActiveAccountCount> result{};
  for (size_t i = 0; i < result.size(); ++i) {
    result[i].windowName.assign(kSpotifyPanelNames[i]);
    if (!SpotifyAccountShouldOwnHost(i)) {
      result[i].trackTitle = L"待機中";
      result[i].confirmedAt = {};
      result[i].confirmed = false;
      continue;
    }
    result[i].trackTitle = slots_[i].processTrackDisplay;
    result[i].confirmedAt = slots_[i].processTitleObservedAt;
    result[i].confirmed = slots_[i].processTitleObserved;
  }
  return result;
}

}  // namespace hp
