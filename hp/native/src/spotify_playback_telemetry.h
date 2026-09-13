#pragma once
#include "common.h"

namespace hp {

inline constexpr UINT kSpotifyPlaybackTelemetryChangedMessage = WM_APP + 23;

std::string CurrentSpotifyPlaybackTelemetryJson() noexcept;

}  // namespace hp
