#pragma once
#include "common.h"
#include "media_surface_anchor.h"

namespace hp {

inline constexpr UINT kStationheadMonitorProbeResultMessage = WM_APP + 31;

// Requests one lightweight DOM probe from the active Stationhead player. The
// request is consumed on the player's next native tick; this keeps WebView2
// access on the existing UI thread and avoids adding another polling thread.
void RequestStationheadMonitorDomProbe() noexcept;

// Stationhead always keeps a real 160x320 portrait surface inside the client
// area. Normal playback, startup and scheduled refreshes stay behind the clock
// panel; authentication/interactive inspection only changes z-order.
inline constexpr LONG kStationheadSurfaceWidth = 160;
inline constexpr LONG kStationheadSurfaceHeight = 320;

// Keep the existing preview state as the reload/startup signal used by the
// Stationhead lifecycle. Geometry no longer depends on it because the surface
// is never parked outside the client area.
inline std::atomic<bool> gStationheadBackgroundPreview{true};

inline bool SetStationheadBackgroundPreview(bool active) noexcept {
  return gStationheadBackgroundPreview.exchange(
             active, std::memory_order_acq_rel) != active;
}

inline bool StationheadBackgroundPreview() noexcept {
  return gStationheadBackgroundPreview.load(std::memory_order_acquire);
}

inline RECT StationheadBackgroundBounds(const RECT& workspaceBounds) noexcept {
  const MediaSurfaceAnchors anchors =
      ComputeMediaSurfaceAnchors(workspaceBounds);
  return CenterMediaSurfaceOnAnchor(
      workspaceBounds,
      anchors.clock,
      kStationheadSurfaceWidth,
      kStationheadSurfaceHeight);
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
