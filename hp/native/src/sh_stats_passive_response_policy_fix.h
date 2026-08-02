#pragma once

namespace hp {

// The page can successfully call streakStats even when its Authorization value
// is assembled below the JavaScript wrapper (for example by a worker or an
// internal request layer). In that case a second page-side request cannot copy
// the credential and every Music metric remains unavailable. Observe the
// response that Stationhead itself already authenticated instead. This wrapper
// is installed at document creation, before the application bundle starts, and
// supports both fetch and XMLHttpRequest.
inline std::wstring StationheadAuthCaptureScriptWithPassiveStats() {
  std::wstring script = StationheadAuthCaptureScript();
  script.append(LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if ((host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) ||
      window.top !== window || window.__homepanelPassiveStatsCapture) {
    return;
  }
  window.__homepanelPassiveStatsCapture = true;

  const post = message => {
    try { window.chrome?.webview?.postMessage(message); } catch (_) {}
  };
  const safePositiveInteger = value =>
    Number.isSafeInteger(Number(value)) && Number(value) > 0
      ? Number(value) : 0;
  const documentGeneration = (() => {
    const current = safePositiveInteger(
      window.__homepanelStationheadStatsDocumentGeneration);
    if (current) return current;
    const generated = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    window.__homepanelStationheadStatsDocumentGeneration = generated;
    return generated;
  })();
  const streakStatsUrl = value => {
    try {
      const url = new URL(String(value || ''), location.href);
      return /(^|\.)stationhead\.com$/i.test(url.hostname) &&
        /^\/me\/channel\/\d+\/streakStats\/?$/i.test(url.pathname);
    } catch (_) {
      return false;
    }
  };
  const validPayload = payload =>
    payload && typeof payload === 'object' &&
    Array.isArray(payload.chart_data) && payload.chart_data.length > 0;
  const nextRequestId = () => {
    const next = safePositiveInteger(
      window.__homepanelStationheadPlayStatsNextRequestId) + 1;
    window.__homepanelStationheadPlayStatsNextRequestId = next;
    window.__homepanelStationheadPlayStatsLatestRequestId = next;
    return next;
  };
  const publish = (payload, responseDate, transport) => {
    if (!validPayload(payload) ||
        window.__homepanelStationheadStatsDocumentGeneration !==
          documentGeneration) {
      return false;
    }
    const parsedDate = Date.parse(String(responseDate || ''));
    const receivedAt = Date.now();
    const requestId = nextRequestId();
    window.__homepanelStationheadPlayStatsSuccessAt = receivedAt;
    window.__homepanelStationheadLastPassiveStatsPayload = payload;
    window.__homepanelStationheadLastPassiveStatsAt = receivedAt;
    post({
      type: 'stationhead-stats-document',
      document_generation: documentGeneration,
    });
    post({
      type: 'stationhead-auth-ready',
      auth_generation: 1,
      reason: 'page-streak-stats-response',
    });
    post({
      type: 'stationhead-play-stats',
      data: payload,
      source: 'page-streak-stats-' + transport + '-v1',
      request_id: requestId,
      document_generation: documentGeneration,
      auth_generation: 1,
      server_date_ms: Number.isFinite(parsedDate) ? parsedDate : receivedAt,
      timezone: typeof payload.timezone === 'string' ? payload.timezone : '',
    });
    return true;
  };

  const previousFetch = typeof window.fetch === 'function'
    ? window.fetch.bind(window) : null;
  if (previousFetch) {
    window.fetch = function(input, init) {
      const requestUrl = typeof input === 'string'
        ? input : (input && input.url) || '';
      return previousFetch(input, init).then(response => {
        if (response?.ok && streakStatsUrl(response.url || requestUrl)) {
          try {
            const copy = response.clone();
            copy.json().then(payload => {
              publish(payload, copy.headers?.get?.('date') || '', 'fetch');
            }).catch(() => {});
          } catch (_) {}
        }
        return response;
      });
    };
  }

  const NativeXhr = window.XMLHttpRequest;
  if (NativeXhr) {
    const previousOpen = NativeXhr.prototype.open;
    const previousSend = NativeXhr.prototype.send;
    NativeXhr.prototype.open = function(method, url, ...rest) {
      this.__homepanelPassiveStatsUrl = url;
      return previousOpen.call(this, method, url, ...rest);
    };
    NativeXhr.prototype.send = function(...args) {
      if (!this.__homepanelPassiveStatsListener) {
        this.__homepanelPassiveStatsListener = true;
        this.addEventListener('load', () => {
          if (this.status < 200 || this.status >= 300 ||
              !streakStatsUrl(this.responseURL ||
                this.__homepanelPassiveStatsUrl)) {
            return;
          }
          try {
            const payload = this.responseType === 'json'
              ? this.response
              : JSON.parse(String(this.responseText || ''));
            publish(payload, this.getResponseHeader?.('date') || '', 'xhr');
          } catch (_) {}
        });
      }
      return previousSend.apply(this, args);
    };
  }
})()
)JS");
  return script;
}

}  // namespace hp

#undef StationheadAuthCaptureScript
#define StationheadAuthCaptureScript \
  StationheadAuthCaptureScriptWithPassiveStats
