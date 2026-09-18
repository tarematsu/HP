#pragma once
#include "common.h"

namespace hp {

inline constexpr UINT kStationheadMonitorProbeResultMessage = WM_APP + 31;

// Requests one lightweight DOM probe from the active Stationhead player. The
// request is consumed on the player's next native tick; this keeps WebView2
// access on the existing UI thread and avoids adding another polling thread.
void RequestStationheadMonitorDomProbe() noexcept;

// Full workspace remains the fallback for authentication/interactive surfaces.
inline RECT StationheadBackgroundBounds(const RECT& workspaceBounds) noexcept {
  return workspaceBounds;
}

// Keep the existing preview state as the reload/startup signal used by the
// Stationhead lifecycle.
inline std::atomic<bool> gStationheadBackgroundPreview{true};

inline bool SetStationheadBackgroundPreview(bool active) noexcept {
  return gStationheadBackgroundPreview.exchange(
             active, std::memory_order_acq_rel) != active;
}

inline bool StationheadBackgroundPreview() noexcept {
  return gStationheadBackgroundPreview.load(std::memory_order_acquire);
}

// Monitor placement and Stationhead WebView layout live in separate modules.
// Keep only the effective foreground bit here so both sides agree on z-order.
inline std::atomic<bool> gStationheadMonitorForeground{false};
inline std::atomic<bool> gStationheadMonitorGridVisible{false};

inline bool SetStationheadMonitorForeground(bool foreground) noexcept {
  return gStationheadMonitorForeground.exchange(
             foreground, std::memory_order_acq_rel) != foreground;
}

inline bool StationheadMonitorForeground() noexcept {
  return gStationheadMonitorForeground.load(std::memory_order_acquire);
}

inline bool SetStationheadMonitorGridVisible(bool visible) noexcept {
  return gStationheadMonitorGridVisible.exchange(
             visible, std::memory_order_acq_rel) != visible;
}

inline bool StationheadMonitorGridVisible() noexcept {
  return gStationheadMonitorGridVisible.load(std::memory_order_acquire);
}

}  // namespace hp