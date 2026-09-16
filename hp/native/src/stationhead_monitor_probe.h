#pragma once
#include "common.h"

namespace hp {

inline constexpr UINT kStationheadMonitorProbeResultMessage = WM_APP + 31;

// Requests one lightweight DOM probe from the active Stationhead player. The
// request is consumed on the player's next native tick; this keeps WebView2
// access on the existing UI thread and avoids adding another polling thread.
void RequestStationheadMonitorDomProbe() noexcept;

// Stationhead keeps a full dashboard-sized HWND/controller viewport so normal
// responsive layout, DOM geometry and CDP coordinates remain stable. The host
// window region is clipped to 1x1 during background playback and restored to
// full size only for authentication/account interaction.
inline RECT StationheadBackgroundBounds(const RECT& workspaceBounds) noexcept {
  return workspaceBounds;
}

// Keep the existing preview state as the reload/startup signal used by the
// Stationhead lifecycle. Geometry no longer depends on it because the internal
// surface always follows the full client area.
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
