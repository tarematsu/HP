#pragma once

#include "common.h"
#include "shared_immutable_vector.h"

namespace hp {

enum class StationheadTabKind {
  None,
  Stationhead,
  Auth,
};

enum StationheadChangeFlags : uint32_t {
  StationheadChangeNone = 0,
  StationheadChangeReturnMain = 1u << 0,
  StationheadChangeReleaseAuth = 1u << 1,
  StationheadChangeShowPlayer = 1u << 2,
};

struct StationheadDailyPlayPoint {
  int64_t dayStartMsUtc = 0;
  int value = 0;

  bool operator==(const StationheadDailyPlayPoint&) const = default;
};

// A single 5-minute sample of today's cumulative play value, kept over time
// so a flattening of consecutive values can be read back later as a gap in
// listening activity (see App::UpdateStationheadPlayHistory).
struct StationheadPlayHistorySample {
  int64_t timestamp = 0;
  int value = 0;

  bool operator==(const StationheadPlayHistorySample&) const = default;
};

struct StationheadStatus {
  // App handles advance this when the Stationhead notification or local
  // track-transition projection changes. Keeping it first lets the
  // default equality operator reject changed snapshots before touching URLs
  // and diagnostic strings.
  uint64_t contentRevision = 0;
  bool created = false;
  bool navigating = false;
  bool playing = false;
  bool loginRequired = false;
  bool spotifyAuthorization = false;
  bool visible = false;
  bool processFailed = false;
  bool spotifyConfigured = false;
  bool authAvailable = false;
  bool audioPlaying = false;
  bool audioMuted = false;
  std::wstring url;
  // Render-only routing metadata for choosing the shared playback feed.
  std::wstring fallbackUrl;
  std::wstring detail;
  // Recent per-day listening activity returned by the authenticated
  // Stationhead account endpoint, oldest first; the last entry is today.
  SharedImmutableVector<StationheadDailyPlayPoint> dailyPlayCounts;
  int64_t dailyPlayStatsUpdatedAt = 0;
  int64_t dailyPlayStatsServerDateAt = 0;
  int64_t dailyPlayStatsReceivedAt = 0;

  bool operator==(const StationheadStatus&) const = default;
};

}  // namespace hp
