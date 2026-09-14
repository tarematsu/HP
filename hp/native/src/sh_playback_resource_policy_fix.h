#pragma once
#include "sh_startup_resource_reduction_policy_fix.h"

namespace hp {

// Use the single audited resource boundary for playback as well. It blocks
// images/fonts, telemetry, social/UI chunks and non-playback media while keeping
// Stationhead/Spotify playback and authenticated data requests fail-open. Do not
// clear the HTTP cache: retaining safe cached assets reduces startup network and
// CPU work on every periodic navigation.
inline void ApplyStationheadResourceBlockingPlaybackSafe(
    ICoreWebView2Environment* environment,
    ICoreWebView2* webview,
    const StationheadConfig& config,
    std::atomic<bool>& armed,
    EventRegistrationToken& token) {
  ApplyStationheadResourceBlockingStartupReduced(
      environment, webview, config, armed, token);
}

// Authenticated statistics acquisition remains independent from presentation
// reduction so UI changes cannot affect the request/auth state machine.
inline std::wstring StationheadPrimaryPlayStatsScript(int channelId) {
  std::wostringstream script;
  script << LR"JS(
(() => {
  const post = message => {
    try { window.chrome?.webview?.postMessage(message); } catch (_) {}
  };
  const headers = window.__homepanelStationheadAuthHeaders;
  if (!headers?.authorization) {
    post({ type: 'stationhead-play-stats-error', error: 'no-auth-header' });
    return false;
  }
  const lastSuccessAt = Number(window.__homepanelStationheadPlayStatsSuccessAt || 0);
  if (lastSuccessAt > 0 && Date.now() - lastSuccessAt < 10 * 60 * 1000) {
    return false;
  }
  const requestId = Number(window.__homepanelStationheadStatsRequestId || 0) + 1;
  window.__homepanelStationheadStatsRequestId = requestId;
  const url = 'https://production1.stationhead.com/me/channel/)JS"
         << channelId << LR"JS(/streakStats';
  fetch(url, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: Object.assign({ accept: 'application/json' }, headers),
  }).then(async response => {
    if (response.status === 401) {
      window.__homepanelStationheadRejectedAuthorization = headers.authorization;
      window.__homepanelStationheadAuthHeaders = null;
      post({
        type: 'stationhead-play-stats-auth-failed',
        status: response.status,
        auth_generation: 1,
      });
      // Primary stats are polled by native code every five minutes. A genuine
      // 401 therefore doubles as a low-frequency auth-expiry signal without a
      // second page-side login timer.
      try { window.chrome?.webview?.postMessage('stationhead-login-required'); } catch (_) {}
      return null;
    }
    if (response.status === 403) {
      post({ type: 'stationhead-play-stats-error', error: 'forbidden' });
      return null;
    }
    if (!response.ok) throw new Error('http-' + response.status);
    return response.json();
  }).then(data => {
    if (data) {
      window.__homepanelStationheadPlayStatsSuccessAt = Date.now();
      post({
        type: 'stationhead-play-stats',
        data,
        source: 'authenticated-api',
        request_id: requestId,
        document_generation: 1,
        auth_generation: 1,
      });
    }
  }).catch(error => {
    post({ type: 'stationhead-play-stats-error', error: String(error?.message || error) });
  });
  return true;
})()
)JS";
  return script.str();
}

}  // namespace hp

#undef ApplyStationheadResourceBlocking
#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingPlaybackSafe

#undef StationheadApiPlayStatsScript
#define StationheadApiPlayStatsScript StationheadPrimaryPlayStatsScript
