#pragma once
#include "common.h"
#include "service_monitor_grid.h"

namespace hp {

inline constexpr UINT kStationheadMonitorProbeResultMessage = WM_APP + 31;

// Requests one lightweight DOM probe from the active Stationhead player. The
// request is consumed on the player's next native tick; this keeps WebView2
// access on the existing UI thread and avoids adding another polling thread.
void RequestStationheadMonitorDomProbe() noexcept;

// Keep the normal Stationhead playback host permanently parked in tile 0 of
// the shared six-window service monitor grid. Background playback still clips
// the host to 1x1; foreground routing only changes visibility/z-order.
inline RECT StationheadBackgroundBounds(const RECT& workspaceBounds) noexcept {
  if (workspaceBounds.right <= workspaceBounds.left ||
      workspaceBounds.bottom <= workspaceBounds.top) {
    return workspaceBounds;
  }
  return ServiceMonitorTileBounds(workspaceBounds, 0);
}

// Keep the existing preview state as the reload/startup signal used by the
// Stationhead lifecycle. Host geometry no longer depends on it.
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

inline bool SetStationheadMonitorForeground(bool foreground) noexcept {
  return gStationheadMonitorForeground.exchange(
             foreground, std::memory_order_acq_rel) != foreground;
}

inline bool StationheadMonitorForeground() noexcept {
  return gStationheadMonitorForeground.load(std::memory_order_acquire);
}

}  // namespace hp
