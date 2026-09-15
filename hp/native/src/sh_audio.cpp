#include "sh.h"

namespace hp {

void StationheadPlayer::SetMuted(bool muted) noexcept {
  audioMuted_.store(muted, std::memory_order_relaxed);
  ApplyMute();
}

void StationheadPlayer::ApplyMute() const noexcept {
  const int muted = audioMuted_.load(std::memory_order_relaxed) ? 1 : 0;
  if (appliedMuted_.load(std::memory_order_relaxed) == muted) return;

  bool applied = true;
  ComPtr<ICoreWebView2> webview = webview_;
  if (webview) {
    ComPtr<ICoreWebView2_8> audio;
    applied = SUCCEEDED(webview.As(&audio)) && audio &&
        SUCCEEDED(audio->put_IsMuted(muted ? TRUE : FALSE));
  }
  appliedMuted_.store(applied ? muted : -1, std::memory_order_relaxed);
}

}  // namespace hp
