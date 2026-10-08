#pragma once

#include "config.h"

namespace hp {

// Stationhead intentionally leaves the HTTP cache and request pipeline intact.
// Images/fonts are already suppressed by the shared WebView2 environment, and
// the final Stationhead request policy must stay fail-open for playback/DRM.
inline void ApplyStationheadJuly19ResourcePolicy(
    ICoreWebView2Environment* environment,
    ICoreWebView2* webview,
    const StationheadConfig& config,
    std::atomic<bool>& armed,
    EventRegistrationToken& token) {
  (void)environment;
  (void)webview;
  (void)config;
  (void)armed;
  (void)token;
}

// PR #48 treats an Authorization header observed from Stationhead's own page
// traffic as the readiness signal. The generation values posted here are only
// compatibility metadata for the current native parser; acquisition still has
// the PR48 single auth state and no cookie-only fallback.
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
      try {
        window.chrome?.webview?.postMessage({
          type: 'stationhead-auth-ready',
          auth_generation: 1,
        });
      } catch (_) {}
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

// Leaderboard collection is deliberately not part of the playback document.
// A dedicated short-lived WebView2 collector reuses the logged-in profile and
// opens /leaderboard independently, so playback DOM/network hooks stay isolated.
inline std::wstring StationheadJuly19AuthAndLoginSettlementScript() {
  std::wstring script = StationheadJuly19AuthCaptureScript();
  script.push_back(L'\n');
  script.append(StationheadLoginSettlementScript());
  return script;
}

}  // namespace hp

#undef ApplyStationheadResourceBlocking
#define ApplyStationheadResourceBlocking ApplyStationheadJuly19ResourcePolicy

#undef StationheadAuthCaptureScript
#define StationheadAuthCaptureScript StationheadJuly19AuthAndLoginSettlementScript

#include "sh_stats_webview_message_policy_fix.h"
