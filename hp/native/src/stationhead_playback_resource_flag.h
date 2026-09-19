#pragma once

#include "webview_playback_resource_mode.h"

namespace hp {

// Stationhead already flips resourceBlockingArmed_ only after native audio is
// confirmed and clears it on stop/navigation/recreate. Preserve that single
// lifecycle boundary and attach the WebView2 resource mode to the same flag.
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
    armed_.store(value, order);
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
  void Apply(bool constrained) noexcept {
    if (!webview_ || !*webview_) return;
    SetWebViewPlaybackMemoryTarget(webview_->Get(), constrained);
    SetWebViewRendererEfficiencyMode(
        environment_ ? environment_->Get() : nullptr,
        webview_->Get(), constrained);
  }

  ComPtr<ICoreWebView2Environment>* environment_ = nullptr;
  ComPtr<ICoreWebView2>* webview_ = nullptr;
  std::atomic<bool> armed_{false};
};

}  // namespace hp
