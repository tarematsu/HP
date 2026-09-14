#pragma once
#include "common.h"

namespace hp {

// Stationhead playback controllers remain visible for their entire lifetime.
// Track-boundary code may still call this compatibility hook, but rendering is
// never suppressed through IsVisible; background cost is handled by 1x1 layout
// and permanent LOW memory targeting instead.
inline void SetStationheadPlaybackRenderingSuppressed(
    bool,
    ICoreWebView2Controller*,
    bool) noexcept {}

inline bool StationheadPlaybackRenderingSuppressed(
    ICoreWebView2Controller*) noexcept {
  return false;
}

}  // namespace hp
