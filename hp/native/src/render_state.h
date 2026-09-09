#pragma once
#include "common.h"
#include "sh.h"

namespace hp {

// Keep dashboard actions outside the update/control message range. This used to
// share WM_APP + 11 with kUpdateShutdownMessage, so every A/B or MUTE click was
// intercepted by ProtectedWindowProc and converted into WM_CLOSE.
inline constexpr UINT kRendererActionMessage = WM_APP + 22;

enum class UiAction {
  None,
  AppUpdate,
  Restart,
  StationheadAudioToggle,
  StationheadAudioMute,
};

struct AirHistorySample {
  int64_t timestamp = 0;
  int co2 = 0;
  double temperature = 0;
  double humidity = 0;

  bool operator==(const AirHistorySample&) const = default;
};

// Stationhead is currently disabled but its implementation is intentionally
// retained. Active native panels bypass this compatibility state and update the
// Renderer directly at their source event boundaries.
struct RenderState {
  StationheadStatus stationhead;
  std::vector<StationheadPlayHistorySample> stationheadPlayHistory;
  uint64_t stationheadPlayHistoryRevision = 0;
};

}  // namespace hp
