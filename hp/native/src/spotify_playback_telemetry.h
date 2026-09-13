#pragma once
#include "common.h"

namespace hp {

inline constexpr UINT kSpotifyPlaybackTelemetryChangedMessage = WM_APP + 23;
inline constexpr ULONGLONG kSpotifyPlaybackTelemetryMinIntervalMs = 15ULL * 1000ULL;

std::string CurrentSpotifyPlaybackTelemetryJson() noexcept;

}  // namespace hp
