#pragma once
#include "sh_startup_resource_reduction_policy_fix.h"
#include "stationhead_native_stats.h"

namespace hp {

// Stationhead's public shell, authenticated route, playback controls, feature
// configuration, and telemetry are loaded through one evolving module/API graph.
// Native request substitution cannot reliably distinguish an optional request
// from a route-critical dependency across account flags and staged deployments.
// Keep the final playback WebView boundary fail-open. Statistics observation is
// read-only and never substitutes a Stationhead response.
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
  // authorization survive the reset. Do not block or synthesize dynamic requests.
  webview->CallDevToolsProtocolMethod(
      L"Network.clearBrowserCache", L"{}", nullptr);

  // Consume the exact streakStats response Stationhead already authenticated.
  // No Authorization/Cookie extraction and no second HTTP request are involved.
  AttachStationheadNativeStats(webview, config.channelId);
}

}  // namespace hp

#undef ApplyStationheadResourceBlocking
#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingPlaybackSafe

// Keep the old page-side scheduler unreachable so Stationhead itself remains
// the only statistics request owner.
#undef kStationheadDailyPlayStatsIntervalMs
#define kStationheadDailyPlayStatsIntervalMs \
  ::hp::kStationheadLegacyStatsPollDisabledIntervalMs
