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

// Keep the legacy page-side statistics scheduler unreachable. One native worker
// owns active streakStats retrieval after WebView2 exposes a successful account
// request's final authenticated Stationhead headers.
inline constexpr int64_t kStationheadLegacyStatsPollDisabledIntervalMs =
    INT64_MAX / 2;

// Observes only Network.responseReceived so browser traffic is not modified and
// no request-id correlation is needed. A successful /me/* or /account/* response
// exposes the request headers actually transmitted; those seed one active worker.
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
