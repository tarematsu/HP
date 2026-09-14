#pragma once
#include "common.h"

namespace hp {

// Stationhead playback controllers stay WebView2-visible for playback stability.
// Background rendering cost is reduced by the 1x1 host layout plus the compact
// CSS/runtime policy; no LOW-memory target or IsVisible suppression is forced.
inline void SetStationheadPlaybackRenderingSuppressed(
    bool,
    ICoreWebView2Controller*,
    bool) noexcept {}

inline bool StationheadPlaybackRenderingSuppressed(
    ICoreWebView2Controller*) noexcept {
  return false;
}

}  // namespace hp
