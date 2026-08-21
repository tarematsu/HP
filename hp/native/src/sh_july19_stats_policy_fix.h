#pragma once

#include "stationhead_native_stats.h"

namespace hp {

inline constexpr int64_t kStationheadJuly19StatsIntervalMs = 5 * 60'000;

// Keep playback fail-open and preserve the signed-in WebView profile. Statistics
// acquisition stays entirely inside the primary Stationhead WebView.
inline void ApplyStationheadJuly19ResourcePolicy(
    ICoreWebView2Environment* environment,
    ICoreWebView2* webview,
    const StationheadConfig& config,
    std::atomic<bool>& armed,
    EventRegistrationToken& token) {
  (void)config;
  (void)armed;
  (void)token;
  if (!environment || !webview) return;

  webview->CallDevToolsProtocolMethod(
      L"Network.clearBrowserCache", L"{}", nullptr);
}

// Observe Authorization on Stationhead's own fetch/XHR traffic when it is
// present. The stats request below no longer depends on this observer firing:
// the existing WebView session cookies are also a valid authentication source.
inline std::wstring StationheadJuly19AuthCaptureScript() {
  static constexpr wchar_t kScript[] = LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if (host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) return;
  if (window.__homepanelStationheadAuthCapture) return;
  window.__homepanelStationheadAuthCapture = true;
  window.__homepanelStationheadAuthHeaders = null;
  window.__homepanelStationheadRejectedAuthorization = null;
  const relevant = url => /(^|\.)stationhead\.com/i.test(String(url || ''));
  const capture = (url, getHeader) => {
    if (!relevant(url)) return;
    const authorization = getHeader('authorization');
    if (!authorization) return;
    if (authorization === window.__homepanelStationheadRejectedAuthorization) return;
    const next = {
      authorization,
      'sth-device-uid': getHeader('sth-device-uid') || '',
      'app-platform': getHeader('app-platform') || 'web',
      'app-version': getHeader('app-version') || '1.0.0',
    };
    const changed = window.__homepanelStationheadAuthHeaders?.authorization !== authorization;
    window.__homepanelStationheadRejectedAuthorization = null;
    window.__homepanelStationheadAuthHeaders = next;
    if (changed) {
      try { window.chrome?.webview?.postMessage({ type: 'stationhead-auth-ready' }); } catch (_) {}
    }
  };
  const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  if (nativeFetch) {
    window.fetch = function(input, init) {
      try {
        const headers = new Headers((input && input.headers) || {});
        if (init && init.headers) {
          const initHeaders = new Headers(init.headers);
          initHeaders.forEach((value, name) => headers.set(name, value));
        }
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        capture(url, name => headers.get(name));
      } catch (_) {}
      return nativeFetch(input, init);
    };
  }
  const NativeXhr = window.XMLHttpRequest;
  if (NativeXhr) {
    const nativeOpen = NativeXhr.prototype.open;
    const nativeSetHeader = NativeXhr.prototype.setRequestHeader;
    const nativeSend = NativeXhr.prototype.send;
    NativeXhr.prototype.open = function(method, url, ...rest) {
      this.__homepanelUrl = url;
      this.__homepanelHeaders = {};
      return nativeOpen.call(this, method, url, ...rest);
    };
    NativeXhr.prototype.setRequestHeader = function(name, value) {
      try { this.__homepanelHeaders[String(name).toLowerCase()] = value; } catch (_) {}
      return nativeSetHeader.call(this, name, value);
    };
    NativeXhr.prototype.send = function(...args) {
      try { capture(this.__homepanelUrl, name => this.__homepanelHeaders?.[name]); } catch (_) {}
      return nativeSend.apply(this, args);
    };
  }
})()
)JS";
  return kScript;
}

inline std::wstring StationheadJuly19AuthAndLoginSettlementScript() {
  std::wstring script = StationheadJuly19AuthCaptureScript();
  script.push_back(L'\n');
  script.append(StationheadLoginSettlementScript());
  return script;
}

// Primary owns one simple streakStats request. Prefer the Authorization/device
// headers captured from Stationhead itself, but do not block the request when
// newer Stationhead sessions authenticate through cookies instead. A 403 is a
// stats permission result and must not discard an otherwise usable playback
// Authorization token; only 401 invalidates the captured token.
inline std::wstring StationheadJuly19ApiPlayStatsScript(int channelId) {
  std::wostringstream script;
  script << LR"JS(
(() => {
  const post = message => {
    try { window.chrome?.webview?.postMessage(message); } catch (_) {}
  };
  const captured = window.__homepanelStationheadAuthHeaders;
  const requestHeaders = { accept: 'application/json' };
  if (captured?.authorization) Object.assign(requestHeaders, captured);
  const url = 'https://production1.stationhead.com/me/channel/)JS"
         << channelId << LR"JS(/streakStats';
  fetch(url, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: requestHeaders,
  }).then(async response => {
    if (response.status === 401) {
      if (captured?.authorization) {
        window.__homepanelStationheadRejectedAuthorization = captured.authorization;
        window.__homepanelStationheadAuthHeaders = null;
      }
      post({ type: 'stationhead-play-stats-auth-failed', status: response.status });
      return null;
    }
    if (response.status === 403) {
      post({ type: 'stationhead-play-stats-error', error: 'forbidden' });
      return null;
    }
    if (!response.ok) throw new Error('http-' + response.status);
    return response.json();
  }).then(data => {
    if (data) post({ type: 'stationhead-play-stats', data, source: 'authenticated-api' });
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
#define ApplyStationheadResourceBlocking ApplyStationheadJuly19ResourcePolicy

#undef kStationheadDailyPlayStatsIntervalMs
#define kStationheadDailyPlayStatsIntervalMs ::hp::kStationheadJuly19StatsIntervalMs

#undef StationheadApiPlayStatsScript
#define StationheadApiPlayStatsScript StationheadJuly19ApiPlayStatsScript

#undef StationheadAuthCaptureScript
#define StationheadAuthCaptureScript StationheadJuly19AuthAndLoginSettlementScript

#include "sh_stats_webview_message_policy_fix.h"
