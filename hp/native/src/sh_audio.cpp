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
