#pragma once
#include "sh_data_acquisition_resource_policy_fix.h"

// Keep the July 23 page-owned Authorization capture, secondary probe and final
// request policy. Only the streakStats response handling is strengthened below:
// the API has used multiple wrapper/key/timestamp shapes, and forwarding the raw
// payload can turn a valid account response into an all-zero native projection.
#undef StationheadAuthCaptureScript
#undef StationheadApiPlayStatsScript
#undef StationheadAuthProbeScript
#undef ApplyStationheadResourceBlocking

namespace hp {

inline std::wstring StationheadAuthCaptureScriptJuly23Baseline() {
  return StationheadAuthCaptureScript();
}

inline std::wstring StationheadApiPlayStatsScriptPayloadSafe(int channelId) {
  std::wostringstream script;
  script << LR"JS(
(() => {
  const post = message => {
    try { window.chrome?.webview?.postMessage(message); } catch (_) {}
  };
  const nativeTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  const resetSuccessThrottle = () => {
    window.__homepanelStationheadPlayStatsSuccessAt = 0;
    window.__homepanelStationheadPlayStatsAuthorization = '';
  };
  const headers = window.__homepanelStationheadAuthHeaders;
  if (!headers?.authorization) {
    resetSuccessThrottle();
    post({ type: 'stationhead-play-stats-error', error: 'no-auth-header' });
    return false;
  }

  const now = Date.now();
  const lastSuccessAt = Number(
    window.__homepanelStationheadPlayStatsSuccessAt || 0);
  const lastSuccessAuthorization = String(
    window.__homepanelStationheadPlayStatsAuthorization || '');
  if (lastSuccessAt > 0 &&
      lastSuccessAuthorization === headers.authorization &&
      now - lastSuccessAt < 10 * 60 * 1000) {
    return false;
  }
  if (window.__homepanelStationheadPlayStatsInFlight) return false;
  window.__homepanelStationheadPlayStatsInFlight = true;

  const numberValue = value => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/,/g, '').trim();
    if (!normalized) return null;
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : null;
  };
  const timestampValue = value => {
    let numeric = numberValue(value);
    if (numeric === null && typeof value === 'string') {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) numeric = parsed;
    }
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    if (numeric < 100000000000) numeric *= 1000;
    else if (numeric > 100000000000000) numeric /= 1000;
    return Math.round(numeric);
  };
  const normalizePoint = point => {
    if (Array.isArray(point) && point.length >= 2) {
      point = { ts: point[0], val: point[1] };
    }
    if (!point || typeof point !== 'object') return null;
    const ts = timestampValue(
      point.ts ?? point.timestamp ?? point.date ?? point.day ?? point.x);
    const val = numberValue(
      point.val ?? point.value ?? point.count ?? point.plays ??
      point.listens ?? point.y);
    if (!Number.isFinite(ts) || !Number.isFinite(val) || val < 0) return null;
    return { ts, val: Math.round(val) };
  };
  const chartCandidates = payload => {
    const candidates = [];
    const containers = [
      payload,
      payload?.data,
      payload?.result,
      payload?.stats,
      payload?.payload,
      payload?.data?.stats,
      payload?.data?.result,
    ];
    for (const container of containers) {
      if (Array.isArray(container)) {
        candidates.push(container);
        continue;
      }
      if (!container || typeof container !== 'object') continue;
      for (const key of [
        'chart_data', 'chartData', 'daily', 'history', 'points', 'values',
      ]) {
        const candidate = container[key];
        if (Array.isArray(candidate)) candidates.push(candidate);
        else if (candidate && typeof candidate === 'object') {
          candidates.push(
            Object.entries(candidate).map(([date, value]) => ({ date, value })));
        }
      }
    }
    return candidates;
  };
  const normalizedChart = payload => {
    const charts = chartCandidates(payload)
      .map(candidate => candidate.map(normalizePoint).filter(Boolean))
      .filter(candidate => candidate.length > 0);
    if (!charts.length) return [];
    const positiveCount = points => points.reduce(
      (count, point) => count + (point.val > 0 ? 1 : 0), 0);
    const latestTimestamp = points => points.reduce(
      (latest, point) => Math.max(latest, point.ts), 0);
    charts.sort((left, right) =>
      positiveCount(right) - positiveCount(left) ||
      right.length - left.length ||
      latestTimestamp(right) - latestTimestamp(left));
    const byTimestamp = new Map();
    for (const point of charts[0]) byTimestamp.set(point.ts, point);
    return Array.from(byTimestamp.values())
      .sort((left, right) => left.ts - right.ts)
      .slice(-40);
  };
  const schedulePayloadRetry = () => {
    if (window.__homepanelStationheadPlayStatsPayloadRetryTimer) return;
    window.__homepanelStationheadPlayStatsPayloadRetryTimer = nativeTimeout(() => {
      window.__homepanelStationheadPlayStatsPayloadRetryTimer = 0;
      resetSuccessThrottle();
      try {
        window.chrome?.webview?.postMessage({ type: 'stationhead-auth-ready' });
      } catch (_) {}
    }, 30 * 1000);
  };
  const clearPayloadRetry = () => {
    const timer = window.__homepanelStationheadPlayStatsPayloadRetryTimer;
    if (!timer) return;
    nativeClearTimeout(timer);
    window.__homepanelStationheadPlayStatsPayloadRetryTimer = 0;
  };

  const url = 'https://production1.stationhead.com/me/channel/)JS"
         << channelId << LR"JS(/streakStats';
  fetch(url, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: Object.assign({ accept: 'application/json' }, headers),
  }).then(async response => {
    if (response.status === 401 || response.status === 403) {
      window.__homepanelStationheadRejectedAuthorization = headers.authorization;
      window.__homepanelStationheadAuthHeaders = null;
      resetSuccessThrottle();
      post({ type: 'stationhead-play-stats-auth-failed', status: response.status });
      return null;
    }
    if (!response.ok) throw new Error('http-' + response.status);
    return response.json();
  }).then(data => {
    if (!data) return;
    const chartData = normalizedChart(data);
    if (!chartData.length) {
      resetSuccessThrottle();
      schedulePayloadRetry();
      post({ type: 'stationhead-play-stats-error', error: 'invalid-payload' });
      return;
    }

    clearPayloadRetry();
    window.__homepanelStationheadPlayStatsSuccessAt = Date.now();
    window.__homepanelStationheadPlayStatsAuthorization = headers.authorization;
    post({
      type: 'stationhead-play-stats',
      data: { chart_data: chartData },
      source: 'authenticated-api-normalized',
    });
  }).catch(error => {
    resetSuccessThrottle();
    schedulePayloadRetry();
    post({
      type: 'stationhead-play-stats-error',
      error: String(error?.message || error),
    });
  }).finally(() => {
    window.__homepanelStationheadPlayStatsInFlight = false;
  });
  return true;
})()
)JS";
  return script.str();
}

inline std::wstring StationheadAuthProbeScriptJuly23Baseline(int channelId) {
  return StationheadAuthProbeScript(channelId);
}

inline void ApplyStationheadResourceBlockingJuly23Baseline(
    ICoreWebView2Environment* environment,
    ICoreWebView2* webview,
    const StationheadConfig& config,
    std::atomic<bool>& armed,
    EventRegistrationToken& token) {
  if (webview) {
    // ConfigureWebView calls this once for every newly created controller, both
    // at application startup and after a WebView rebuild. Clear only Chromium's
    // browser cache here. Cookies and DOM storage are intentionally untouched so
    // the Stationhead login survives the reset.
    webview->CallDevToolsProtocolMethod(L"Network.enable", L"{}", nullptr);
    webview->CallDevToolsProtocolMethod(
        L"Network.clearBrowserCache", L"{}", nullptr);
  }
  ApplyStationheadResourceBlocking(
      environment, webview, config, armed, token);
}

}  // namespace hp

#define StationheadAuthCaptureScript \
  StationheadAuthCaptureScriptJuly23Baseline
#define StationheadApiPlayStatsScript \
  StationheadApiPlayStatsScriptPayloadSafe
#define StationheadAuthProbeScript \
  StationheadAuthProbeScriptJuly23Baseline
#define ApplyStationheadResourceBlocking \
  ApplyStationheadResourceBlockingJuly23Baseline
