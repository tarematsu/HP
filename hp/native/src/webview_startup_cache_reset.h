#pragma once

#include "common.h"

namespace hp {

using WebViewStartupCacheResetCompletion = std::function<void(HRESULT)>;

// Startup cache/data deletion has been removed. Keep this synchronous
// compatibility shim only for older call sites so startup and recovery never
// clear HTTP cache, CacheStorage, Service Workers, cookies, or profile data.
inline void ResetWebViewStartupCaches(
    ICoreWebView2*,
    WebViewStartupCacheResetCompletion completion) noexcept {
  if (!completion) return;
  try {
    completion(S_OK);
  } catch (...) {
  }
}

}  // namespace hp

// sh.cpp includes this compatibility header immediately after the Stationhead
// policy chain. Play-count collection is retired: prevent the old scheduler
// from becoming due and make a legacy direct call harmless.
#undef kStationheadDailyPlayStatsIntervalMs
#define kStationheadDailyPlayStatsIntervalMs 4'000'000'000'000'000'000LL
#undef StationheadApiPlayStatsScript
#define StationheadApiPlayStatsScript(channelId) std::wstring(L"void 0;")
