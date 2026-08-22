#pragma once

#include "common.h"

namespace hp {

inline std::atomic<bool> gStationheadManualForeground{false};

inline bool StationheadManualForegroundEnabled() noexcept {
  return gStationheadManualForeground.load(std::memory_order_acquire);
}

inline bool ToggleStationheadManualForeground() noexcept {
  const bool next = !StationheadManualForegroundEnabled();
  gStationheadManualForeground.store(next, std::memory_order_release);
  return next;
}

inline void ClearStationheadManualForeground() noexcept {
  gStationheadManualForeground.store(false, std::memory_order_release);
}

}  // namespace hp
