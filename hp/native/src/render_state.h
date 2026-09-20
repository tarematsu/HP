#pragma once
#include "common.h"

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
  StationheadPrimaryAudio,
  StationheadPeer1Audio,
  StationheadPeer2Audio,
  StationheadPeer3Audio,
  StationheadPeer4Audio,
  StationheadPeer5Audio,
};

struct AirHistorySample {
  int64_t timestamp = 0;
  int co2 = 0;
  double temperature = 0;
  double humidity = 0;

  bool operator==(const AirHistorySample&) const = default;
};

}  // namespace hp
