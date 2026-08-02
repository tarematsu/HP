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

// Installs native request/response observers on the primary Stationhead
// WebView. No page script or WebMessage protocol is involved.
void AttachStationheadNativeStats(ICoreWebView2* webview, int channelId);

// Immutable renderer-facing projection of the process-local native store.
StationheadNativeStatsSnapshot GetStationheadNativeStatsSnapshot();
uint64_t GetStationheadNativeStatsRevision();

}  // namespace hp
