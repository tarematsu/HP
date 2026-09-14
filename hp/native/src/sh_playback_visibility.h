#pragma once
#include "common.h"

namespace hp {

// Playback rendering is independent for the retained Stationhead roles. The
// WebView itself stays alive and keeps audio/network activity; this flag only
// controls whether the playback controller is asked to render while it is in
// the background.
inline std::atomic<bool>& StationheadPlaybackRenderingSuppressedState(
    bool secondary) noexcept {
  static std::atomic<bool> primary{false};
  static std::atomic<bool> secondaryState{false};
  return secondary ? secondaryState : primary;
}

inline void SetStationheadPlaybackRenderingSuppressed(
    bool secondary, bool suppressed) noexcept {
  StationheadPlaybackRenderingSuppressedState(secondary).store(
      suppressed, std::memory_order_release);
}

inline bool StationheadPlaybackRenderingSuppressed(bool secondary) noexcept {
  return StationheadPlaybackRenderingSuppressedState(secondary).load(
      std::memory_order_acquire);
}

}  // namespace hp
