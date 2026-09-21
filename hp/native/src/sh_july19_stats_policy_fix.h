#pragma once

#include "config.h"

namespace hp {

inline constexpr int64_t kStationheadJuly19StatsIntervalMs = 5 * 60'000;

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
  window.__homepanelStationheadStatsRequestId = 0;
  try {
    window.chrome?.webview?.postMessage({
      type: 'stationhead-stats-document',
      document_generation: 1,
    });
  } catch (_) {}
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

inline std::wstring StationheadJuly19LeaderboardProbeScript() {
  static constexpr wchar_t kPart1[] = LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if (host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) return;
  if (window.__homepanelLeaderboardProbeInstalled) return;
  window.__homepanelLeaderboardProbeInstalled = true;
  const key = 'homepanel.stationhead.leaderboardProbe.v1';
  const onBoard = () => /(^|\/)leaderboard(?:\/|$)/i.test(location.pathname);
  const post = (kind, detail) => {
    try {
      window.chrome?.webview?.postMessage({
        type: 'stationhead-play-stats-error',
        error: 'leaderboard-probe:' + kind + ':' + String(detail || '').replace(/\s+/g, ' ').slice(0, 1400),
      });
    } catch (_) {}
  };
  const save = row => {
    try {
      const safe = {
        observed_at: Date.now(),
        source: String(row.source || '').slice(0, 32),
        page: String(row.page || location.href).slice(0, 1000),
        url: String(row.url || '').slice(0, 2000),
        method: String(row.method || 'GET').slice(0, 16),
        status: Number(row.status || 0),
        content_type: String(row.content_type || '').slice(0, 160),
        body: String(row.body || '').slice(0, 262144),
      };
      const rows = JSON.parse(localStorage.getItem(key) || '[]');
      rows.push(safe);
      localStorage.setItem(key, JSON.stringify(rows.slice(-20)));
      post(safe.source, safe.method + ' ' + safe.status + ' ' + safe.url +
        (safe.body ? ' body=' + safe.body.slice(0, 800) : ''));
    } catch (error) { post('save-error', error?.message || error); }
  };
  const originalFetch = window.fetch ? window.fetch.bind(window) : null;
  if (originalFetch) {
    window.fetch = function(input, init) {
      const url = typeof input === 'string' ? input : (input?.url || '');
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      const result = originalFetch(input, init);
      if (onBoard()) Promise.resolve(result).then(async response => {
        const responseUrl = String(response?.url || url || '');
        if (!/stationhead\.com/i.test(responseUrl)) return;
        const type = String(response.headers?.get?.('content-type') || '');
        const body = /json|text/i.test(type) ? await response.clone().text().catch(() => '') : '';
        save({ source: 'fetch', page: location.href, url: responseUrl,
          method, status: response.status, content_type: type, body });
      }).catch(() => {});
      return result;
    };
  }
)JS";
  static constexpr wchar_t kPart2[] = LR"JS(
  const Xhr = window.XMLHttpRequest;
  if (Xhr) {
    const open = Xhr.prototype.open;
    const send = Xhr.prototype.send;
    Xhr.prototype.open = function(method, url, ...rest) {
      this.__hpLbMethod = String(method || 'GET').toUpperCase();
      return open.call(this, method, url, ...rest);
    };
    Xhr.prototype.send = function(...args) {
      if (onBoard()) this.addEventListener('loadend', () => {
        try {
          const type = String(this.getResponseHeader('content-type') || '');
          const body = /json|text/i.test(type) && (!this.responseType || this.responseType === 'text')
            ? String(this.responseText || '') : '';
          save({ source: 'xhr', page: location.href, url: this.responseURL,
            method: this.__hpLbMethod, status: this.status, content_type: type, body });
        } catch (_) {}
      }, { once: true });
      return send.apply(this, args);
    };
  }
  if (window.top === window) {
    const launch = () => {
      if (document.getElementById('__hpLeaderboardProbe')) return;
      const frame = document.createElement('iframe');
      frame.id = '__hpLeaderboardProbe';
      frame.src = '/leaderboard?homepanel_probe=1&ts=' + Date.now();
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
      frame.addEventListener('load', () => setTimeout(() => {
        try {
          const w = frame.contentWindow;
          const d = frame.contentDocument;
          const resources = Array.from(w?.performance?.getEntriesByType?.('resource') || [])
            .map(x => String(x?.name || '')).filter(x => /stationhead\.com/i.test(x)).slice(0, 80);
          save({ source: 'snapshot', page: String(w?.location?.href || ''),
            url: String(w?.location?.href || ''), method: 'GET', status: 0,
            content_type: 'text/plain', body: JSON.stringify({
              text: String(d?.body?.innerText || '').slice(0, 32768), resources,
            }) });
        } catch (error) { post('snapshot-error', error?.message || error); }
      }, 10000), { once: true });
      (document.body || document.documentElement).appendChild(frame);
      post('start', frame.src);
      setTimeout(() => { try { frame.remove(); } catch (_) {} }, 30000);
    };
    if (document.body) setTimeout(launch, 3000);
    else document.addEventListener('DOMContentLoaded', () => setTimeout(launch, 3000), { once: true });
  }
})()
)JS";
  std::wstring script = kPart1;
  script.append(kPart2);
  return script;
}

inline std::wstring StationheadJuly19AuthAndLoginSettlementScript() {
  std::wstring script = StationheadJuly19AuthCaptureScript();
  script.push_back(L'\n');
  script.append(StationheadJuly19LeaderboardProbeScript());
  script.push_back(L'\n');
  script.append(StationheadLoginSettlementScript());
  return script;
}

inline std::wstring StationheadJuly19ApiPlayStatsScript(int channelId) {
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
    if (response.status === 401 || response.status === 403) {
      window.__homepanelStationheadRejectedAuthorization = headers.authorization;
      window.__homepanelStationheadAuthHeaders = null;
      post({
        type: 'stationhead-play-stats-auth-failed',
        status: response.status,
        auth_generation: 1,
      });
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
#define ApplyStationheadResourceBlocking ApplyStationheadJuly19ResourcePolicy

#undef kStationheadDailyPlayStatsIntervalMs
#define kStationheadDailyPlayStatsIntervalMs ::hp::kStationheadJuly19StatsIntervalMs

#undef StationheadApiPlayStatsScript
#define StationheadApiPlayStatsScript StationheadJuly19ApiPlayStatsScript

#undef StationheadAuthCaptureScript
#define StationheadAuthCaptureScript StationheadJuly19AuthAndLoginSettlementScript

#include "sh_stats_webview_message_policy_fix.h"