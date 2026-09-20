#pragma once
#include "common.h"

namespace hp {

inline constexpr UINT kStationheadMonitorProbeResultMessage = WM_APP + 31;

// Requests one lightweight DOM probe from the active Stationhead player. The
// request is consumed on the player's next native tick; this keeps WebView2
// access on the existing UI thread and avoids adding another polling thread.
void RequestStationheadMonitorDomProbe() noexcept;

// Stationhead keeps the dashboard-sized host HWND so placement and z-order stay
// stable. During healthy background playback the WebView controller viewport may
// be reduced independently; interactive, authentication and Monitor B paths
// restore the controller to the full workspace before user/native interaction.
inline RECT StationheadBackgroundBounds(const RECT& workspaceBounds) noexcept {
  return workspaceBounds;
}

// Keep the existing preview state as the reload/startup signal used by the
// Stationhead lifecycle. Host geometry no longer depends on it because the HWND
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
// A value of 1..6 identifies the single Stationhead window selected for the
// monitor surface. Zero means no Stationhead monitor is selected.
inline std::atomic<unsigned> gStationheadMonitorProfile{0};

inline bool SetStationheadMonitorProfile(unsigned profile) noexcept {
  if (profile > 6) profile = 0;
  return gStationheadMonitorProfile.exchange(
             profile, std::memory_order_acq_rel) != profile;
}

inline unsigned StationheadMonitorProfile() noexcept {
  return gStationheadMonitorProfile.load(std::memory_order_acquire);
}

inline unsigned StationheadProfileNumber(
    const std::wstring& profileName) noexcept {
  if (profileName == L"spotify-v2-1") return 1;
  if (profileName == L"spotify-v2-2") return 2;
  if (profileName == L"spotify-v2-3") return 3;
  if (profileName == L"spotify-v2-4") return 4;
  if (profileName == L"spotify-v2-5") return 5;
  if (profileName == L"spotify-v2-6") return 6;
  return 0;
}

inline bool StationheadMonitorForegroundForProfile(
    const std::wstring& profileName) noexcept {
  const unsigned selected = StationheadMonitorProfile();
  return selected != 0 && selected == StationheadProfileNumber(profileName);
}

inline bool SetStationheadMonitorForeground(bool foreground) noexcept {
  return SetStationheadMonitorProfile(foreground ? 6u : 0u);
}

inline bool StationheadMonitorForeground() noexcept {
  return StationheadMonitorProfile() != 0;
}

}  // namespace hp
