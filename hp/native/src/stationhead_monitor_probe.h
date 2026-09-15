#pragma once
#include "common.h"

namespace hp {

inline constexpr UINT kStationheadMonitorProbeResultMessage = WM_APP + 31;

// Requests one lightweight DOM probe from the active Stationhead player. The
// request is consumed on the player's next native tick; this keeps WebView2
// access on the existing UI thread and avoids adding another polling thread.
void RequestStationheadMonitorDomProbe() noexcept;

// Stationhead keeps a real 480x270 surface even while it is not presented.
// Startup begins in the in-client background preview immediately, before the
// WebView is created, and the scheduled 50-minute reload reuses that preview.
// Stable playback is parked offscreen; authentication has its own foreground
// surface.
inline constexpr LONG kStationheadSurfaceWidth = 480;
inline constexpr LONG kStationheadSurfaceHeight = 270;
inline constexpr LONG kStationheadOffscreenGap = 32;

inline RECT StationheadOffscreenBounds(const RECT& workspaceBounds) noexcept {
  const LONG left = workspaceBounds.right + kStationheadOffscreenGap;
  const LONG top = workspaceBounds.top;
  return RECT{
      left,
      top,
      left + kStationheadSurfaceWidth,
      top + kStationheadSurfaceHeight,
  };
}

// The first Stationhead host layout happens before the deferred Start() call.
// Arm the startup preview by default so that first layout is already 480x270
// inside the client area and HWND_BOTTOM; it stays there through initial
// navigation and Start Listening until stable audio explicitly clears it.
inline std::atomic<bool> gStationheadBackgroundPreview{true};

inline bool SetStationheadBackgroundPreview(bool active) noexcept {
  return gStationheadBackgroundPreview.exchange(
             active, std::memory_order_acq_rel) != active;
}

inline bool StationheadBackgroundPreview() noexcept {
  return gStationheadBackgroundPreview.load(std::memory_order_acquire);
}

inline RECT StationheadBackgroundBounds(const RECT& workspaceBounds) noexcept {
  if (!StationheadBackgroundPreview()) {
    return StationheadOffscreenBounds(workspaceBounds);
  }
  const LONG left = workspaceBounds.left;
  const LONG top = workspaceBounds.top;
  return RECT{
      left,
      top,
      left + kStationheadSurfaceWidth,
      top + kStationheadSurfaceHeight,
  };
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
