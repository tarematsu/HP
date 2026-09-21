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
  static constexpr wchar_t kScript[] = LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if (host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) return;
  if (window.__homepanelStationheadLeaderboardProbeInstalled) return;
  window.__homepanelStationheadLeaderboardProbeInstalled = true;
  window.__homepanelStationheadLeaderboardProbeStarted = false;
  window.__homepanelStationheadLeaderboardRecords = [];

  const storageKey = 'homepanel.stationhead.leaderboardProbe.v1';
  const leaderboardPage = () => /(^|\/)leaderboard(?:\/|$)/i.test(String(location.pathname || ''));
  const stationheadUrl = value => {
    try {
      const parsed = new URL(String(value || ''), location.href);
      const parsedHost = String(parsed.hostname || '').toLowerCase();
      return parsed.protocol === 'https:' &&
        (parsedHost === 'stationhead.com' || parsedHost.endsWith('.stationhead.com'));
    } catch (_) {
      return false;
    }
  };
  const postProbe = (kind, detail) => {
    try {
      const compact = String(detail || '').replace(/\s+/g, ' ').slice(0, 1400);
      window.chrome?.webview?.postMessage({
        type: 'stationhead-play-stats-error',
        error: 'leaderboard-probe:' + kind + ':' + compact,
      });
    } catch (_) {}
  };
  const store = record => {
    try {
      const safe = {
        observed_at: Date.now(),
        source: String(record?.source || 'network').slice(0, 40),
        page: String(record?.page || location.href || '').slice(0, 1000),
        url: String(record?.url || '').slice(0, 2000),
        method: String(record?.method || 'GET').slice(0, 16),
        status: Number(record?.status || 0),
        content_type: String(record?.content_type || '').slice(0, 200),
        body: String(record?.body || '').slice(0, 262144),
      };
      const records = Array.isArray(window.__homepanelStationheadLeaderboardRecords)
        ? window.__homepanelStationheadLeaderboardRecords
        : [];
      records.push(safe);
      while (records.length > 20) records.shift();
      window.__homepanelStationheadLeaderboardRecords = records;
      localStorage.setItem(storageKey, JSON.stringify(records));
      postProbe(
        safe.source,
        safe.method + ' ' + safe.status + ' ' + safe.url +
          (safe.body ? ' body=' + safe.body.slice(0, 800) : ''),
      );
    } catch (error) {
      postProbe('store-error', String(error?.message || error));
    }
  };
  const recordResponse = (url, method, response) => {
    if (!leaderboardPage() || !response) return;
    const responseUrl = String(response.url || url || '');
    if (!stationheadUrl(responseUrl)) return;
    const contentType = String(response.headers?.get?.('content-type') || '');
    if (!/json|text|javascript/i.test(contentType)) {
      store({
        source: 'network', page: location.href, url: responseUrl, method,
        status: response.status, content_type: contentType, body: '',
      });
      return;
    }
    Promise.resolve(response.clone().text()).then(body => {
      store({
        source: 'network', page: location.href, url: responseUrl, method,
        status: response.status, content_type: contentType, body,
      });
    }).catch(() => {});
  };

  const authFetch = window.fetch ? window.fetch.bind(window) : null;
  if (authFetch) {
    window.fetch = function(input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const promise = authFetch(input, init);
      Promise.resolve(promise).then(response => recordResponse(url, method, response)).catch(() => {});
      return promise;
    };
  }

  const NativeXhr = window.XMLHttpRequest;
  if (NativeXhr) {
    const currentOpen = NativeXhr.prototype.open;
    const currentSend = NativeXhr.prototype.send;
    NativeXhr.prototype.open = function(method, url, ...rest) {
      this.__homepanelLeaderboardMethod = String(method || 'GET').toUpperCase();
      return currentOpen.call(this, method, url, ...rest);
    };
    NativeXhr.prototype.send = function(...args) {
      if (leaderboardPage()) {
        this.addEventListener('loadend', () => {
          try {
            const contentType = String(this.getResponseHeader('content-type') || '');
            let body = '';
            if (/json|text|javascript/i.test(contentType) &&
                (this.responseType === '' || this.responseType === 'text')) {
              body = String(this.responseText || '');
            }
            store({
              source: 'xhr', page: location.href,
              url: String(this.responseURL || this.__homepanelUrl || ''),
              method: this.__homepanelLeaderboardMethod || 'GET', status: this.status,
              content_type: contentType, body,
            });
          } catch (_) {}
        }, { once: true });
      }
      return currentSend.apply(this, args);
    };
  }

  const replayCandidate = (url, page) => {
    const headers = window.__homepanelStationheadAuthHeaders;
    if (!authFetch || !headers?.authorization || !stationheadUrl(url)) return;
    authFetch(url, {
      method: 'GET', credentials: 'include', cache: 'no-store',
      headers: Object.assign({ accept: 'application/json, text/plain, */*' }, headers),
    }).then(async response => {
      const body = await response.text().catch(() => '');
      store({
        source: 'replay', page, url, method: 'GET', status: response.status,
        content_type: String(response.headers.get('content-type') || ''), body,
      });
    }).catch(error => postProbe('replay-error', String(error?.message || error)));
  };

  const start = () => {
    if (window.top !== window || window.__homepanelStationheadLeaderboardProbeStarted) return;
    if (!window.__homepanelStationheadAuthHeaders?.authorization) return;
    window.__homepanelStationheadLeaderboardProbeStarted = true;
    const launch = () => {
      try {
        const frame = document.createElement('iframe');
        frame.id = '__homepanelStationheadLeaderboardProbeFrame';
        frame.src = '/leaderboard?homepanel_probe=1&ts=' + Date.now();
        frame.setAttribute('aria-hidden', 'true');
        frame.style.cssText = 'position:fixed!important;left:-10000px!important;top:-10000px!important;width:1px!important;height:1px!important;border:0!important;opacity:0!important;pointer-events:none!important;';
        frame.addEventListener('load', () => {
          setTimeout(() => {
            try {
              const frameWindow = frame.contentWindow;
              const frameDocument = frame.contentDocument;
              const href = String(frameWindow?.location?.href || '');
              const text = String(frameDocument?.body?.innerText || '').slice(0, 32768);
              const resources = Array.from(frameWindow?.performance?.getEntriesByType?.('resource') || [])
                .map(entry => String(entry?.name || ''))
                .filter(url => /production1\.stationhead\.com/i.test(url))
                .slice(0, 80);
              store({
                source: 'dom-snapshot', page: href, url: href,
                method: 'GET', status: 0, content_type: 'text/plain',
                body: JSON.stringify({ text, resources }),
              });
              const candidate = resources.find(url =>
                /leaderboard|ranking|rank|weekly|week|chart|top/i.test(url));
              if (candidate) replayCandidate(candidate, href);
              else postProbe('discovery', resources.length
                ? 'no rank-like API name; resources=' + resources.join(',').slice(0, 1100)
                : 'no Stationhead API resources observed');
            } catch (error) {
              postProbe('inspect-error', String(error?.message || error));
            }
          }, 10000);
        }, { once: true });
        (document.body || document.documentElement).appendChild(frame);
        setTimeout(() => {
          try { frame.remove(); } catch (_) {}
        }, 30000);
        postProbe('start', frame.src);
      } catch (error) {
        postProbe('start-error', String(error?.message || error));
      }
    };
    if (document.body || document.documentElement) launch();
    else document.addEventListener('DOMContentLoaded', launch, { once: true });
  };
  const waitForAuth = () => {
    if (window.top !== window || window.__homepanelStationheadLeaderboardProbeStarted) return;
    if (window.__homepanelStationheadAuthHeaders?.authorization) {
      start();
      return;
    }
    setTimeout(waitForAuth, 1000);
  };
  if (window.top === window) setTimeout(waitForAuth, 0);
})()
)JS";
  return kScript;
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