namespace hp {
namespace {

constexpr wchar_t kSpotifyMessageSeparator = L'\x1f';
constexpr std::array<std::wstring_view, kSpotifyActiveAccountCount> kSpotifyPanelNames = {
    L"yuukiar"};

constexpr wchar_t kSpotifyStaticPageBootstrapScript[] = LR"JS(
(() => {
  window.__homePanelSpotifyGeneration =
      window.__homePanelSpotifyGeneration || '0';
  window.__homePanelSpotifyTryDirectPlay = media => {
    const generation = String(window.__homePanelSpotifyGeneration || '0');
    if (!media || media.tagName !== 'AUDIO' ||
        typeof media.play !== 'function' ||
        window.__homePanelSpotifyDirectPlayGeneration === generation) {
      return false;
    }
    window.__homePanelSpotifyDirectPlayGeneration = generation;
    const runtime = window.__homePanelSpotifyMediaObserverRuntime;
    if (runtime && typeof runtime.armTrustedStart === 'function') {
      runtime.armTrustedStart(generation);
    }
    try {
      const result = media.play();
      if (result && typeof result.catch === 'function') result.catch(() => {});
      return true;
    } catch (_) {
      return false;
    }
  };

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

void SpotifyWebViews::PostSpotifyPageContext(Slot& slot) noexcept {
  if (!slot.webview) return;
  PostSpotifyTargetDescriptorForSlot(slot);
}

std::array<SpotifyPlaybackStatus, kSpotifyActiveAccountCount>
SpotifyWebViews::PlaybackStatuses() const noexcept {
  std::array<SpotifyPlaybackStatus, kSpotifyActiveAccountCount> result{};
  for (size_t i = 0; i < result.size(); ++i) {
    result[i].windowName.assign(kSpotifyPanelNames[i]);
    result[i].trackTitle = slots_[i].observedTrackTitle;
    result[i].confirmedAt = slots_[i].playbackConfirmedAt;
    result[i].confirmed = slots_[i].playbackConfirmed;
  }
  return result;
}

}  // namespace hp
