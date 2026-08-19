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

// The legacy member remains declared in StationheadPlayer for source
// compatibility, but its scheduler interval is redirected to this unreachable
// compile-time value. Therefore no statistics ExecuteScript poll runs.
inline constexpr int64_t kStationheadLegacyStatsPollDisabledIntervalMs =
    INT64_MAX / 2;

// Observes the browser's own successful streakStats network response through
// WebView2 DevTools Protocol events. Authentication remains entirely inside
// Stationhead's WebView: no credential copying, second HTTP client, page script,
// WebMessage statistics protocol, or parallel statistics request path exists.
void AttachStationheadNativeStats(ICoreWebView2* webview, int channelId);

// Implemented in stationhead_native_stats.cpp. The response parser, short
// request-id correlation state, recent-hour history, and store remain private.
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
