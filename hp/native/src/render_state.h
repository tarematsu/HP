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

// Retained only for the Renderer compatibility entry point. Active App state is
// delivered directly to the native panels.
struct RenderState {
  StationheadStatus stationhead;
};

}  // namespace hp
