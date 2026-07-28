#include "sh.h"
#include "sh_shared.h"

namespace hp {

void StationheadPlayer::SetMuted(bool muted) noexcept {
  audioMuted_.store(muted, std::memory_order_relaxed);
  ApplyMute();
}

bool StationheadPlayer::Muted() const noexcept {
  return audioMuted_.load(std::memory_order_relaxed);
}

void StationheadPlayer::SetVolume(double volume) noexcept {
  audioVolume_.store(std::clamp(volume, 0.0, 1.0), std::memory_order_relaxed);
  ApplyVolume();
}

double StationheadPlayer::Volume() const noexcept {
  return audioVolume_.load(std::memory_order_relaxed);
}

void StationheadPlayer::ApplyMute() const noexcept {
  const int muted = audioMuted_.load(std::memory_order_relaxed) ? 1 : 0;
  if (appliedMuted_.load(std::memory_order_relaxed) != muted) {
    bool applied = true;
    if (webview_) {
      ComPtr<ICoreWebView2_8> audio;
      applied = SUCCEEDED(webview_.As(&audio)) && audio &&
          SUCCEEDED(audio->put_IsMuted(muted ? TRUE : FALSE));
    }
    appliedMuted_.store(applied ? muted : -1, std::memory_order_relaxed);
  }

  // Volume is a playback-document policy. Applying it to the transient Spotify
  // authorization WebView is unnecessary and used to make every A/B or MUTE
  // action touch a controller that may be closing. Keep the two concerns scoped
  // to the persistent playback WebView only.
  ApplyVolume();
}

void StationheadPlayer::ApplyVolume() const noexcept {
  const int percent = std::clamp(
      static_cast<int>(audioVolume_.load(std::memory_order_relaxed) * 100.0 + 0.5), 0, 100);
  if (appliedVolumePercent_.load(std::memory_order_relaxed) == percent) return;
  if (!webview_) {
    appliedVolumePercent_.store(percent, std::memory_order_relaxed);
    return;
  }

  try {
    const std::wstring script = StationheadVolumeScript(percent);
    const HRESULT result = webview_->ExecuteScript(script.c_str(), nullptr);
    appliedVolumePercent_.store(
        SUCCEEDED(result) ? percent : -1, std::memory_order_relaxed);
  } catch (...) {
    // SetMuted/SetVolume are noexcept UI actions. An allocation failure while
    // preparing the optional volume script must not terminate HomePanel.
    appliedVolumePercent_.store(-1, std::memory_order_relaxed);
  }
}

// Window B's isolated WebView2 environment still ships the platform's default
// user agent, which is otherwise identical to Window A's. Tag it distinctly
// so Stationhead's own session/device bookkeeping does not conflate the two
// independent, cookie-isolated sessions with a single device identity.
void StationheadPlayer::EnsureDistinctBrowserIdentity() noexcept {
  if (!webview_ || identityWebview_ == webview_.Get()) return;
  identityWebview_ = webview_.Get();
  ComPtr<ICoreWebView2Settings> settings;
  if (FAILED(webview_->get_Settings(&settings)) || !settings) return;
  ComPtr<ICoreWebView2Settings2> settings2;
  if (FAILED(settings.As(&settings2)) || !settings2) return;
  LPWSTR rawUserAgent = nullptr;
  if (FAILED(settings2->get_UserAgent(&rawUserAgent)) || !rawUserAgent) return;
  std::wstring userAgent(rawUserAgent);
  CoTaskMemFree(rawUserAgent);
  if (userAgent.find(L"HomePanelSecondary/") == std::wstring::npos) {
    userAgent += L" HomePanelSecondary/1.0";
    settings2->put_UserAgent(userAgent.c_str());
  }
}

}  // namespace hp
