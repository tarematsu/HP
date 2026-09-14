#pragma once
#include "common.h"

namespace hp {

struct StationheadPlaybackRenderingState {
  std::atomic<ICoreWebView2Controller*> controller{nullptr};
  std::atomic<bool> suppressed{false};
};

inline StationheadPlaybackRenderingState& StationheadPlaybackRenderingStateFor(
    bool secondary) noexcept {
  static StationheadPlaybackRenderingState primary;
  static StationheadPlaybackRenderingState secondaryState;
  return secondary ? secondaryState : primary;
}

// Bind suppression to the controller that requested it. If that WebView is
// recreated, the new controller remains visible until the page establishes a
// fresh finite-duration playback interval and asks to suppress rendering again.
inline void SetStationheadPlaybackRenderingSuppressed(
    bool secondary,
    ICoreWebView2Controller* controller,
    bool suppressed) noexcept {
  auto& state = StationheadPlaybackRenderingStateFor(secondary);
  state.controller.store(controller, std::memory_order_release);
  state.suppressed.store(suppressed, std::memory_order_release);
}

inline bool StationheadPlaybackRenderingSuppressed(
    ICoreWebView2Controller* controller) noexcept {
  if (!controller) return false;
  for (bool secondary : {false, true}) {
    auto& state = StationheadPlaybackRenderingStateFor(secondary);
    if (state.controller.load(std::memory_order_acquire) == controller &&
        state.suppressed.load(std::memory_order_acquire)) {
      return true;
    }
  }
  return false;
}

}  // namespace hp
