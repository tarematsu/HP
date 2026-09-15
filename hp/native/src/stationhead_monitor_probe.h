#pragma once
#include "common.h"

namespace hp {

inline constexpr UINT kStationheadMonitorProbeResultMessage = WM_APP + 31;

// Requests one lightweight DOM probe from the active Stationhead player. The
// request is consumed on the player's next native tick; this keeps WebView2
// access on the existing UI thread and avoids adding another polling thread.
void RequestStationheadMonitorDomProbe() noexcept;

// Stationhead keeps a real 480x270 surface even while it is not presented.
// Normal background placement stays inside the parent client area behind the
// dashboard. Foreground presentation may use the full workspace.
inline constexpr LONG kStationheadSurfaceWidth = 480;
inline constexpr LONG kStationheadSurfaceHeight = 270;

inline RECT StationheadBackgroundBounds(const RECT& workspaceBounds) noexcept {
  const LONG left = workspaceBounds.left;
  const LONG top = workspaceBounds.top;
  return RECT{
      left,
      top,
      left + kStationheadSurfaceWidth,
      top + kStationheadSurfaceHeight,
  };
}

// Compatibility name retained for the existing layout call sites. Background
// WebViews are intentionally kept in the client area instead of being moved
// outside the window; z-order keeps them behind the dashboard.
inline RECT StationheadOffscreenBounds(const RECT& workspaceBounds) noexcept {
  return StationheadBackgroundBounds(workspaceBounds);
}

// Monitor placement and Stationhead WebView layout live in separate modules.
// Keep only the effective foreground bit here so both sides agree on geometry
// and z-order.
inline std::atomic<bool> gStationheadMonitorForeground{false};

inline bool SetStationheadMonitorForeground(bool foreground) noexcept {
  return gStationheadMonitorForeground.exchange(
             foreground, std::memory_order_acq_rel) != foreground;
}

inline bool StationheadMonitorForeground() noexcept {
  return gStationheadMonitorForeground.load(std::memory_order_acquire);
}

}  // namespace hp
