#include "sh.h"

namespace hp {

void StationheadPlayer::SetMuted(bool muted) noexcept {
  audioMuted_.store(muted, std::memory_order_relaxed);
  ApplyMute();
}

void StationheadPlayer::ApplyMute() const noexcept {
  const BOOL desired =
      audioMuted_.load(std::memory_order_relaxed) ? TRUE : FALSE;
  const int desiredValue = desired ? 1 : 0;

  bool applied = false;
  ComPtr<ICoreWebView2> webview = webview_;
  if (webview) {
    ComPtr<ICoreWebView2_8> audio;
    if (SUCCEEDED(webview.As(&audio)) && audio) {
      BOOL current = FALSE;
      const HRESULT readResult = audio->get_IsMuted(&current);
      if (SUCCEEDED(readResult) && current == desired) {
        applied = true;
      } else if (SUCCEEDED(audio->put_IsMuted(desired))) {
        BOOL confirmed = desired;
        applied = FAILED(audio->get_IsMuted(&confirmed)) || confirmed == desired;
      }
    }
  }

  // A missing/recreated WebView is not an applied state. Keeping -1 makes the
  // next routing pass retry instead of trusting stale bookkeeping.
  appliedMuted_.store(applied ? desiredValue : -1, std::memory_order_relaxed);
}

bool StationheadPlayer::NeedsInteractiveWindow() const {
  return (selectedTab_ == StationheadTabKind::Stationhead && loginRequired_) ||
         selectedTab_ == StationheadTabKind::Auth || spotifyAuthorization_;
}

}  // namespace hp
