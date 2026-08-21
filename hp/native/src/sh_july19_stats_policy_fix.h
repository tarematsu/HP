#pragma once

// sh_track_boundary_script.h maps the normal document-start hook to the
// current login-settlement script before including this policy. Drop that
// temporary alias here so the restored wrapper calls the original pre-#368
// Authorization observer from sh_shared.h exactly once.
#ifdef StationheadAuthCaptureScript
#undef StationheadAuthCaptureScript
#endif

namespace hp {

// The last sustained stable play-count period ended when PR #368 changed
// Authorization reuse semantics. Use the original page-owned capture and the
// pre-#368 streakStats request shape, while preserving the current login probe.
// The small identity envelope below exists only because the current native
// WebMessage reducer still carries later document/auth/request guards; results
// are written to StationheadStatus, not to a parallel statistics store.
inline std::wstring StationheadPre368AuthAndLoginSettlementScript() {
  std::wstring script = StationheadAuthCaptureScript();
  script.append(LR"JS(
(() => {
  const webview = window.chrome?.webview;
  if (!webview || typeof webview.postMessage !== 'function' ||
      window.__homepanelPre368StatsIdentity) return;
  const nativePost = webview.postMessage.bind(webview);
  const identity = {
    documentGeneration: Math.max(1, Date.now()),
    authGeneration: 0,
    requestId: 0,
  };
  window.__homepanelPre368StatsIdentity = identity;
  nativePost({
    type: 'stationhead-stats-document',
    document_generation: identity.documentGeneration,
  });
  const publishAuth = () => {
    if (!window.__homepanelStationheadAuthHeaders?.authorization) return;
    identity.authGeneration += 1;
    nativePost({
      type: 'stationhead-auth-ready',
      auth_generation: identity.authGeneration,
    });
  };
  window.addEventListener('homepanel-stationhead-auth-ready', publishAuth);
  publishAuth();
})()
)JS");
  script.push_back(L'\n');
  script.append(StationheadLoginSettlementScript());
  return script;
}

// This is the pre-#368 request policy: the Primary WebView owns streakStats,
// the newest page-owned Authorization is used immediately, a successful result
// gets a ten-minute quiet period, 401 rejects the token, and 403 does not erase
// the playback session. There is one request owner and one result destination.
inline std::wstring StationheadPre368ApiPlayStatsScript(int channelId) {
  std::wostringstream script;
  script << LR"JS(
(() => {
  const post = message => {
    try { window.chrome?.webview?.postMessage(message); } catch (_) {}
  };
  const resetSuccessThrottle = () => {
    window.__homepanelStationheadPlayStatsSuccessAt = 0;
    window.__homepanelStationheadPlayStatsAuthorization = '';
  };
  const headers = window.__homepanelStationheadAuthHeaders;
  const identity = window.__homepanelPre368StatsIdentity;
  if (!headers?.authorization || !identity?.documentGeneration ||
      !identity?.authGeneration) {
    resetSuccessThrottle();
    post({ type: 'stationhead-play-stats-error', error: 'no-auth-header' });
    return false;
  }
  const lastSuccessAt = Number(window.__homepanelStationheadPlayStatsSuccessAt || 0);
  const lastSuccessAuthorization = String(
    window.__homepanelStationheadPlayStatsAuthorization || '');
  if (lastSuccessAt > 0 &&
      lastSuccessAuthorization === headers.authorization &&
      Date.now() - lastSuccessAt < 10 * 60 * 1000) {
    return false;
  }
  const requestId = ++identity.requestId;
  const documentGeneration = identity.documentGeneration;
  const authGeneration = identity.authGeneration;
  const url = 'https://production1.stationhead.com/me/channel/)JS"
         << channelId << LR"JS(/streakStats';
  fetch(url, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: Object.assign({ accept: 'application/json' }, headers),
  }).then(async response => {
    if (response.status === 401) {
      resetSuccessThrottle();
      window.__homepanelStationheadRejectedAuthorization = headers.authorization;
      window.__homepanelStationheadAuthHeaders = null;
      post({
        type: 'stationhead-play-stats-auth-failed',
        status: response.status,
        auth_generation: authGeneration,
      });
      return null;
    }
    if (response.status === 403) {
      resetSuccessThrottle();
      post({ type: 'stationhead-play-stats-error', error: 'forbidden' });
      return null;
    }
    if (!response.ok) throw new Error('http-' + response.status);
    return response.json();
  }).then(data => {
    if (!data) return;
    window.__homepanelStationheadPlayStatsSuccessAt = Date.now();
    window.__homepanelStationheadPlayStatsAuthorization = headers.authorization;
    post({
      type: 'stationhead-play-stats',
      data,
      source: 'authenticated-api',
      request_id: requestId,
      document_generation: documentGeneration,
      auth_generation: authGeneration,
    });
  }).catch(error => {
    post({
      type: 'stationhead-play-stats-error',
      error: String(error?.message || error),
    });
  });
  return true;
})()
)JS";
  return script.str();
}

}  // namespace hp

// Final selection after the later policy stack. Playback/resource policy stays
// current; only the statistics acquisition generators are restored.
#undef StationheadAuthCaptureScript
#define StationheadAuthCaptureScript StationheadPre368AuthAndLoginSettlementScript

#undef StationheadApiPlayStatsScript
#define StationheadApiPlayStatsScript StationheadPre368ApiPlayStatsScript
