#pragma once

#include "webview_playback_resource_mode.h"

namespace hp {

// Stationhead enters the constrained state only after native audio is confirmed.
// Any navigation (including direct Reload recovery) immediately drops back to
// NORMAL before the new document has to initialize DRM/audio again.
class StationheadPlaybackResourceFlag final {
 public:
  StationheadPlaybackResourceFlag(
      ComPtr<ICoreWebView2Environment>* environment,
      ComPtr<ICoreWebView2>* webview) noexcept
      : environment_(environment), webview_(webview) {}

  StationheadPlaybackResourceFlag& operator=(bool value) noexcept {
    store(value, std::memory_order_seq_cst);
    return *this;
  }

  void store(
      bool value,
      std::memory_order order = std::memory_order_seq_cst) noexcept {
    const bool changed = armed_.exchange(value, order) != value;
    if (!changed) return;
    Apply(value);
  }

  [[nodiscard]] bool load(
      std::memory_order order = std::memory_order_seq_cst) const noexcept {
    return armed_.load(order);
  }

  // Existing Stationhead request-filter code intentionally receives the raw
  // atomic flag. Keep that contract without duplicating the resource blocker.
  operator std::atomic<bool>&() noexcept { return armed_; }
  operator const std::atomic<bool>&() const noexcept { return armed_; }

 private:
  void EnsureNavigationResetHook() noexcept {
    if (!webview_ || !*webview_) return;
    ICoreWebView2* current = webview_->Get();
    if (current == navigationHookWebview_) return;

    EventRegistrationToken token{};
    const HRESULT result = current->add_NavigationStarting(
        Callback<ICoreWebView2NavigationStartingEventHandler>(
            [this](ICoreWebView2*,
                   ICoreWebView2NavigationStartingEventArgs*) -> HRESULT {
              store(false, std::memory_order_release);
              return S_OK;
            }).Get(),
        &token);
    if (SUCCEEDED(result)) {
      navigationHookWebview_ = current;
      navigationStartingToken_ = token;
    }
  }

  void Apply(bool constrained) noexcept {
    const uint64_t generation =
        BeginPlaybackResourceModeChange(generation_);
    // Increment even without a live WebView so a close/recreate can invalidate
    // an older asynchronous LOW request that has not completed yet.
    if (!webview_ || !*webview_) return;

    if (constrained) EnsureNavigationResetHook();
    SetWebViewPlaybackMemoryTarget(webview_->Get(), constrained);
    SetWebViewRendererEfficiencyMode(
        environment_ ? environment_->Get() : nullptr,
        webview_->Get(), constrained, generation_, generation);
  }

  ComPtr<ICoreWebView2Environment>* environment_ = nullptr;
  ComPtr<ICoreWebView2>* webview_ = nullptr;
  PlaybackResourceModeGeneration generation_{
      std::make_shared<std::atomic<uint64_t>>(0)};
  std::atomic<bool> armed_{false};
  ICoreWebView2* navigationHookWebview_ = nullptr;
  EventRegistrationToken navigationStartingToken_{};
};

}  // namespace hp
