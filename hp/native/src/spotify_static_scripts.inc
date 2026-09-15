namespace hp {
namespace {

constexpr wchar_t kSpotifyMessageSeparator = L'\x1f';
constexpr std::array<std::wstring_view, kSpotifyActiveAccountCount> kSpotifyPanelNames = {
    L"yuukiar"};

constexpr wchar_t kSpotifyStaticPageBootstrapScript[] = LR"JS(
(() => {
  window.__homePanelSpotifyGeneration =
      window.__homePanelSpotifyGeneration || '0';

  // Visual-only reduction for the Spotify player page. Keep the native
  // playback/status contract untouched: media elements, the target-page Play
  // control, the global play/pause control and now-playing identity nodes are
  // deliberately not selected here.
  const visualStyleId = 'homepanel-spotify-render-reduction';
  if (!document.getElementById(visualStyleId)) {
    const style = document.createElement('style');
    style.id = visualStyleId;
    style.textContent = `
      html { scroll-behavior: auto !important; }
      body { background: #000 !important; }

      aside,
      nav,
      canvas,
      [role="tooltip"],
      [data-testid="global-nav-bar"],
      [data-testid="left-sidebar"],
      [data-testid="right-sidebar"],
      [data-testid="buddy-feed"],
      [data-testid="download-app"],
      [data-testid="upgrade-button"],
      [class*="Root__nav-bar"],
      [class*="Root__right-sidebar"],
      [class*="main-yourLibraryX-library"],
      [class*="main-buddyFeed-buddyFeedRoot"] {
        display: none !important;
        visibility: hidden !important;
        content-visibility: hidden !important;
        contain: strict !important;
      }

      /* Preserve the section that owns Spotify's target-page Play button, but
         skip paint/layout work for recommendation and auxiliary sections. */
      main section:not(:has(button[data-testid="play-button"])) {
        content-visibility: hidden !important;
        contain: strict !important;
      }

      /* Image requests are already blocked natively on player pages; this also
         prevents placeholder/fallback image paint without removing DOM nodes. */
      img,
      picture {
        visibility: hidden !important;
        opacity: 0 !important;
      }

      [aria-hidden="true"],
      [role="presentation"],
      [data-testid*="skeleton"],
      [class*="Skeleton"],
      [class*="skeleton"],
      [class*="shimmer"],
      *::before,
      *::after {
        animation: none !important;
        transition: none !important;
        filter: none !important;
        backdrop-filter: none !important;
        box-shadow: none !important;
        text-shadow: none !important;
      }

      main,
      [data-testid="main-view-container"] {
        background: #000 !important;
        box-shadow: none !important;
        filter: none !important;
        backdrop-filter: none !important;
      }

      ::-webkit-scrollbar { display: none !important; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

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
    result[i].trackTitle = slots_[i].observedTrackTitle;
    result[i].confirmedAt = slots_[i].playbackConfirmedAt;
    result[i].confirmed = slots_[i].playbackConfirmed;
  }
  return result;
}

}  // namespace hp
