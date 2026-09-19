#include "webview_playback_resource_mode.h"

namespace hp {
namespace {

constexpr LONG kSpotifyInternalViewportWidth = 320;
constexpr LONG kSpotifyInternalViewportHeight = 160;

RECT SpotifyFixedViewportBounds() noexcept {
  return RECT{0, 0, kSpotifyInternalViewportWidth,
              kSpotifyInternalViewportHeight};
}

RECT SpotifyControllerBounds(HWND hostWindow, bool authentication) noexcept {
  if (authentication && hostWindow && IsWindow(hostWindow)) {
    RECT client{};
    if (GetClientRect(hostWindow, &client) &&
        client.right > client.left && client.bottom > client.top) {
      return client;
    }
  }
  return SpotifyFixedViewportBounds();
}

}  // namespace

void SpotifyWebViews::ApplyPlaybackResourceMode(
    Slot& slot, bool constrained) noexcept {
  if (!slot.webview) {
    slot.memoryUsageTargetLevel = -1;
    return;
  }

  const int desiredMemoryTarget = constrained
      ? static_cast<int>(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW)
      : static_cast<int>(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL);
  if (slot.memoryUsageTargetLevel != desiredMemoryTarget &&
      SetWebViewPlaybackMemoryTarget(slot.webview.Get(), constrained)) {
    slot.memoryUsageTargetLevel = desiredMemoryTarget;
  }

  // Efficiency mode is process-scoped, so resolve the renderer from this
  // WebView's main FrameId instead of touching every process in the shared
  // environment. Pre-playback/recovery states explicitly restore normal mode.
  SetWebViewRendererEfficiencyMode(
      slot.environment.Get(), slot.webview.Get(), constrained);
}

}  // namespace hp
