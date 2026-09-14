namespace hp {
namespace {

constexpr wchar_t kSpotifyMessageSeparator = L'\x1f';
constexpr std::array<std::wstring_view, kSpotifyActiveAccountCount> kSpotifyPanelNames = {
    L"yuukiar"};

constexpr wchar_t kSpotifyStaticPageBootstrapScript[] = LR"JS(
(() => {
  const styleId = '__homePanelSpotifyStaticLightweight';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* Keep the player footer / elapsed-time / progress controls untouched.
         Keep player controls, elapsed-time text and progress/slider trees out
         of the heavy CSS rules even if Spotify moves them under <main>.
         Play/Pause controls are also trusted-input targets used by native. */
      main,
      main :not(
        [data-testid="now-playing-bar"], [data-testid="now-playing-bar"] *,
        [data-testid="now-playing-widget"], [data-testid="now-playing-widget"] *,
        [data-testid="play-button"], [data-testid="play-button"] *,
        [data-testid="control-button-playpause"], [data-testid="control-button-playpause"] *,
        [data-testid*="playback"], [data-testid*="playback"] *,
        [data-testid*="progress"], [data-testid*="progress"] *,
        [role="slider"], [role="slider"] *,
        [aria-valuenow], [aria-valuenow] *,
        footer, footer *
      ),
      [data-testid="left-sidebar"], [data-testid="left-sidebar"] *,
      [data-testid="global-nav-bar"], [data-testid="global-nav-bar"] *,
      [data-testid="topbar"], [data-testid="topbar"] *,
      [data-testid="buddy-feed"], [data-testid="buddy-feed"] *,
      [aria-label="Friend Activity"], [aria-label="Friend Activity"] *,
      [aria-label="フレンドアクティビティ"], [aria-label="フレンドアクティビティ"] *,
      aside, aside * {
        animation: none !important;
        transition: none !important;
        scroll-behavior: auto !important;
        background-image: none !important;
        box-shadow: none !important;
        filter: none !important;
        backdrop-filter: none !important;
        text-shadow: none !important;
        will-change: auto !important;
      }
      /* Do not hide SVG globally: Spotify's Play/Pause glyphs are aria-hidden
         SVGs inside otherwise valid buttons. Removing them can collapse the
         trusted input target or leave an unlabeled-looking control. */
      img, picture, video, canvas {
        display: none !important;
      }
      [data-testid="play-button"],
      [data-testid="control-button-playpause"] {
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
        content-visibility: visible !important;
      }
      [data-testid="play-button"] svg,
      [data-testid="control-button-playpause"] svg,
      [data-testid="now-playing-bar"] svg,
      [data-testid="now-playing-widget"] svg,
      footer svg {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
      [data-testid="left-sidebar"],
      [data-testid="global-nav-bar"],
      [data-testid="topbar"],
      [data-testid="buddy-feed"],
      [aria-label="Friend Activity"],
      [aria-label="フレンドアクティビティ"],
      aside {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
        content-visibility: hidden !important;
        contain: strict !important;
      }
      main {
        contain: layout style paint !important;
      }
      [data-testid="now-playing-bar"],
      [data-testid="now-playing-widget"],
      footer {
        contain: layout style paint !important;
      }
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
