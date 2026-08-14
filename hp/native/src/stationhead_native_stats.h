#pragma once

#include "common.h"

namespace hp {

struct StationheadNativeDailyPlayPoint {
  int64_t dayStartMsUtc = 0;
  int value = 0;
};

struct StationheadNativeStatsSnapshot {
  std::vector<StationheadNativeDailyPlayPoint> daily;
  int recentHour = -1;
  int64_t updatedAt = 0;
  uint64_t revision = 0;
};

inline constexpr int64_t kStationheadLegacyStatsPollDisabledIntervalMs =
    INT64_MAX / 2;

// Observe the browser's successful statistics response directly. No separate
// native HTTP replay is required for the Music panel.
void AttachStationheadNativeStats(ICoreWebView2* webview, int channelId);

StationheadNativeStatsSnapshot GetStationheadNativeStatsSnapshot();
uint64_t GetStationheadNativeStatsRevision();

class StationheadNativeStatsAccess final {
 public:
  StationheadNativeStatsSnapshot Snapshot() const {
    return GetStationheadNativeStatsSnapshot();
  }
  uint64_t Revision() const {
    return GetStationheadNativeStatsRevision();
  }
};

inline StationheadNativeStatsAccess& GlobalStationheadNativeStatsStore() {
  static StationheadNativeStatsAccess access;
  return access;
}

}  // namespace hp
