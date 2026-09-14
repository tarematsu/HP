#pragma once
#include "common.h"

namespace hp {

inline constexpr UINT kStationheadMonitorProbeResultMessage = WM_APP + 31;

// Requests one lightweight DOM probe from the active Stationhead player. The
// request is consumed on the player's next native tick; this keeps WebView2
// access on the existing UI thread and avoids adding another polling thread.
void RequestStationheadMonitorDomProbe() noexcept;

// Returns true only when the effective foreground state changed. The layout
// layer uses this state to keep background playback low-memory and invisible
// without hiding Monitor B or Monitor A authentication surfaces.
bool SetStationheadMonitorForeground(bool foreground) noexcept;
bool StationheadMonitorForeground() noexcept;

}  // namespace hp
