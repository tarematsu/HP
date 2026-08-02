#pragma once
#include "sh_startup_resource_reduction_policy_fix.h"
#include "stationhead_native_stats.h"

namespace hp {

// Stationhead's public shell, authenticated route, playback controls, feature
// configuration, and telemetry are loaded through one evolving module/API graph.
// Native request substitution cannot reliably distinguish an optional request
// from a route-critical dependency across account flags and staged deployments.
// Keep the final playback WebView boundary fail-open. The primary profile adds
// one read-only native statistics observer; it never substitutes a response.
inline void ApplyStationheadResourceBlockingPlaybackSafe(
    ICoreWebView2Environment* environment,
    ICoreWebView2* webview,
    const StationheadConfig& config,
    std::atomic<bool>& armed,
    EventRegistrationToken& token) {
  (void)armed;
  (void)token;
  if (!environment || !webview) return;

  // Clear only Chromium's HTTP cache once per newly created playback controller.
  // Cookies and DOM storage remain intact, so Stationhead login and Spotify
  // authorization survive the reset. Do not install request substitution or CDP
  // URL blocking: a delayed module, feature flag, or authenticated API must never
  // be replaced by a synthetic response after the route shell has mounted.
  webview->CallDevToolsProtocolMethod(L"Network.enable", L"{}", nullptr);
  webview->CallDevToolsProtocolMethod(
      L"Network.clearBrowserCache", L"{}", nullptr);

  // The first playback WebView is Window A/Default and owns shared/service-worker
  // traffic. Attach the native C++ statistics client exactly once there. Window B
  // does not duplicate account-statistics requests.
  if (StationheadOwnsWorkerRequestFilters(webview)) {
    AttachStationheadNativeStats(webview, config.channelId);
  }
}

}  // namespace hp

#undef ApplyStationheadResourceBlocking
#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingPlaybackSafe

// Stop the old page-generated statistics poll at its scheduler boundary. The
// legacy member remains only for source compatibility and is never reached.
#undef kStationheadDailyPlayStatsIntervalMs
#define kStationheadDailyPlayStatsIntervalMs \
  ::hp::kStationheadLegacyStatsPollDisabledIntervalMs
