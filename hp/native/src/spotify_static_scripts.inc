namespace hp {
namespace {

constexpr wchar_t kSpotifyMessageSeparator = L'\x1f';
constexpr std::array<std::wstring_view, kSpotifyActiveAccountCount> kSpotifyPanelNames = {
    L"yuukiar", L"ten", L"nagi", L"hinata"};

constexpr wchar_t kSpotifyStaticPageBootstrapScript[] = LR"JS(
(() => {
  const styleId = '__homePanelSpotifyStaticLightweight';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      *, *::before, *::after {
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
      img, picture, video, canvas,
      svg[aria-hidden='true'] {
        display: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

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

  if (window.__homePanelSpotifyStaticBridgeInstalled) return true;
  window.__homePanelSpotifyStaticBridgeInstalled = true;
  window.__homePanelSpotifyNativeTarget = null;

  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener('message', event => {
      if (typeof event.data !== 'string') return;
      const fields = event.data.split('\u001f');
      if (fields[0] === 'spotify:account') {
        mountBadge(fields[1] || '');
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

}  // namespace

void SpotifyWebViews::PostSpotifyPageContext(Slot& slot) noexcept {
  if (!slot.webview) return;
  if (slot.index < kSpotifyPanelNames.size()) {
    std::wstring message = L"spotify:account";
    message.push_back(kSpotifyMessageSeparator);
    message.append(kSpotifyPanelNames[slot.index]);
    slot.webview->PostWebMessageAsString(message.c_str());
  }
  PostSpotifyTargetDescriptorForSlot(slot);
}

std::array<SpotifyPlaybackStatus, kSpotifyActiveAccountCount>
SpotifyWebViews::PlaybackStatuses() const noexcept {
  std::array<SpotifyPlaybackStatus, kSpotifyActiveAccountCount> result{};
  for (size_t i = 0; i < result.size(); ++i) {
    result[i].windowName.assign(kSpotifyPanelNames[i]);
    if (const ManagedTrack* const track = CurrentMusicTrack(slots_[i])) {
      result[i].trackTitle = track->title;
    }
    result[i].confirmedAt = slots_[i].playbackConfirmedAt;
    result[i].confirmed = slots_[i].playbackConfirmed;
  }
  return result;
}

}  // namespace hp
