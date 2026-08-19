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

// Keep the legacy page-side statistics scheduler unreachable. The browser's
// own authenticated streakStats response is the only statistics request path.
inline constexpr int64_t kStationheadLegacyStatsPollDisabledIntervalMs =
    INT64_MAX / 2;

// Reads Stationhead's already-authenticated successful streakStats response
// directly from WebView2's WebResourceResponseReceived event. No credential
// copying, second HTTP client, DevTools network-event correlation, page script,
// or WebMessage statistics protocol participates in this path.
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
