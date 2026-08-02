#pragma once

#include "stationhead_native_stats.h"

namespace hp {

inline void ApplyStationheadResourceBlockingWithNativeStats(
    ICoreWebView2Environment* environment,
    ICoreWebView2* webview,
    const StationheadConfig& config,
    std::atomic<bool>& armed,
    EventRegistrationToken& token) {
  ApplyStationheadResourceBlocking(
      environment, webview, config, armed, token);
  // The Default profile is Window A and owns environment-wide worker traffic.
  // Register exactly one native credential/request pipeline there. Window B
  // remains playback-only and never duplicates account-statistics downloads.
  if (webview && StationheadOwnsWorkerRequestFilters(webview)) {
    AttachStationheadNativeStats(webview, config.channelId);
  }
}

}  // namespace hp

#undef ApplyStationheadResourceBlocking
#define ApplyStationheadResourceBlocking \
  ApplyStationheadResourceBlockingWithNativeStats
