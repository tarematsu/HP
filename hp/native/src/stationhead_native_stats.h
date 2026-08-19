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

// Installs one read-only observer on a Stationhead playback WebView. A successful
// authenticated streakStats response is parsed and published directly; no
// credential copying, second HTTP client, page script, or request filter exists.
void AttachStationheadNativeStats(ICoreWebView2* webview, int channelId);

// Implemented in stationhead_native_stats.cpp. The response parser and store stay
// private so the renderer only sees the narrow snapshot/revision interface.
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
