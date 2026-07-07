#pragma once
#include "common.h"

namespace hp::layout {
inline constexpr float kDesignWidth = 1280.0f;
inline constexpr float kDesignHeight = 880.0f;
inline constexpr float kPanelWidth = 425.0f;
inline constexpr float kPanelHeight = 292.0f;
inline constexpr D2D1_RECT_F kLocalPanel{0, 0, kPanelWidth, kPanelHeight};

inline constexpr size_t kSpotify = 0;
inline constexpr size_t kNews = 1;
inline constexpr size_t kUnusedTopRight = 2;
inline constexpr size_t kCo2 = 3;
inline constexpr size_t kClockWeather = 4;
inline constexpr size_t kSwitchBot = 5;
inline constexpr size_t kOctopus = 6;
inline constexpr size_t kRadar = 7;
inline constexpr size_t kOperations = 8;

inline constexpr D2D1_RECT_F kDataRefresh{16, 62, 138, 122};
inline constexpr D2D1_RECT_F kAppUpdate{150, 62, 272, 122};
inline constexpr D2D1_RECT_F kRestart{284, 62, 406, 122};
inline constexpr D2D1_RECT_F kExit{219, 140, 406, 202};
inline constexpr D2D1_RECT_F kMaintenance{16, 140, 203, 202};
inline constexpr D2D1_RECT_F kSpotifyConnect{105, 234, 320, 276};
inline constexpr D2D1_RECT_F kRadarPrevious{19, 240, 55, 278};
inline constexpr D2D1_RECT_F kRadarToggle{61, 240, 121, 278};
inline constexpr D2D1_RECT_F kRadarNext{127, 240, 163, 278};
inline constexpr D2D1_RECT_F kRadarSlider{175, 252, 398, 264};
}  // namespace hp::layout

#define dataRefresh_ ::hp::layout::kDataRefresh
#define appUpdate_ ::hp::layout::kAppUpdate
#define restart_ ::hp::layout::kRestart
#define exit_ ::hp::layout::kExit
#define maintenance_ ::hp::layout::kMaintenance
#define spotifyConnect_ ::hp::layout::kSpotifyConnect
#define radarPrevious_ ::hp::layout::kRadarPrevious
#define radarToggle_ ::hp::layout::kRadarToggle
#define radarNext_ ::hp::layout::kRadarNext
#define radarSlider_ ::hp::layout::kRadarSlider
