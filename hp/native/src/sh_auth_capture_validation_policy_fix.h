#pragma once

namespace hp {

// A bearer token is only reusable after Stationhead has returned an HTTP
// response that did not explicitly reject it. The prior policy remembered the
// token immediately after dispatching fetch/XHR, so a 401 token could remain in
// the false-positive recovery cache and be restored after the login surface
// briefly disappeared.
inline std::wstring StationheadAuthCaptureScriptResponseValidated() {
  std::wstring script = StationheadAuthCaptureScript();

  static constexpr std::wstring_view kAcceptanceHelpers = LR"JS(  const rememberAcceptedAuthorization = () => {
    const headers = window.__homepanelStationheadAuthHeaders;
    if (headers?.authorization) {
      window.__homepanelStationheadLastAcceptedAuthHeaders = Object.assign({}, headers);
    }
  };
  const releaseRejectedAuthorization = authorization => {
    if (!authorization ||
        authorization !== window.__homepanelStationheadRejectedAuthorization ||
        window.__homepanelStationheadBlockingLoginVisible !== false) {
      return;
    }
    window.__homepanelStationheadRejectedAuthorization = null;
  };
)JS";
  static constexpr std::wstring_view kAcceptanceHelpersFixed = LR"JS(  const trustedStationheadRequest = value => {
    try {
      const parsed = new URL(String(value || ''), location.href);
      const targetHost = String(parsed.hostname || '').toLowerCase();
      return parsed.protocol === 'https:' &&
        (targetHost === 'stationhead.com' ||
         targetHost.endsWith('.stationhead.com'));
    } catch (_) {
      return false;
    }
  };
  const candidateFromHeaders = headers => {
    const authorization = headers?.get?.('authorization') || '';
    if (!authorization) return null;
    return {
      authorization,
      'sth-device-uid': headers.get('sth-device-uid') || '',
      'app-platform': headers.get('app-platform') || 'web',
      'app-version': headers.get('app-version') || '1.0.0',
    };
  };
  const acceptAuthorizationCandidate = candidate => {
    if (!candidate?.authorization) return;
    const current = window.__homepanelStationheadAuthHeaders;
    if (current?.authorization &&
        current.authorization !== candidate.authorization) {
      return;
    }
    const changed = current?.authorization !== candidate.authorization;
    window.__homepanelStationheadRejectedAuthorization = null;
    window.__homepanelStationheadAuthHeaders = Object.assign({}, candidate);
    window.__homepanelStationheadLastAcceptedAuthHeaders =
      Object.assign({}, candidate);
    if (changed) {
      try {
        window.dispatchEvent(new Event('homepanel-stationhead-auth-ready'));
      } catch (_) {}
      try {
        window.chrome?.webview?.postMessage({
          type: 'stationhead-auth-ready',
        });
      } catch (_) {}
    }
  };
  const rejectAuthorization = authorization => {
    if (!authorization) return;
    if (window.__homepanelStationheadLastAcceptedAuthHeaders?.authorization ===
        authorization) {
      window.__homepanelStationheadLastAcceptedAuthHeaders = null;
    }
    const current = window.__homepanelStationheadAuthHeaders;
    if (!current?.authorization || current.authorization === authorization) {
      window.__homepanelStationheadRejectedAuthorization = authorization;
      if (current?.authorization === authorization) {
        window.__homepanelStationheadAuthHeaders = null;
      }
    }
  };
  const recordAuthorizationStatus = (candidate, statusValue) => {
    if (!candidate?.authorization) return;
    const status = Number(statusValue || 0);
    if (status === 401) {
      rejectAuthorization(candidate.authorization);
    } else if (status > 0) {
      acceptAuthorizationCandidate(candidate);
    }
  };
)JS";

  static constexpr std::wstring_view kFetchCapture = LR"JS(  const currentFetch = window.fetch ? window.fetch.bind(window) : null;
  if (currentFetch) {
    window.fetch = function(input, init) {
      try {
        const headers = new Headers((input && input.headers) || {});
        if (init && init.headers) {
          const initHeaders = new Headers(init.headers);
          initHeaders.forEach((value, name) => headers.set(name, value));
        }
        releaseRejectedAuthorization(headers.get('authorization') || '');
      } catch (_) {}
      const result = currentFetch(input, init);
      rememberAcceptedAuthorization();
      return result;
    };
  }
)JS";
  static constexpr std::wstring_view kFetchCaptureFixed = LR"JS(  const currentFetch = window.fetch ? window.fetch.bind(window) : null;
  if (currentFetch) {
    window.fetch = function(input, init) {
      let candidate = null;
      try {
        const headers = new Headers((input && input.headers) || {});
        if (init && init.headers) {
          const initHeaders = new Headers(init.headers);
          initHeaders.forEach((value, name) => headers.set(name, value));
        }
        const requestUrl = typeof input === 'string' ? input :
          (window.URL && input instanceof window.URL ? input.href :
            (input && input.url) || '');
        if (trustedStationheadRequest(requestUrl)) {
          candidate = candidateFromHeaders(headers);
        }
      } catch (_) {}
      const result = currentFetch(input, init);
      if (candidate && typeof result?.then === 'function') {
        result.then(
          response => recordAuthorizationStatus(candidate, response?.status),
          () => {});
      }
      return result;
    };
  }
)JS";

  static constexpr std::wstring_view kXhrCapture = LR"JS(  const NativeXhr = window.XMLHttpRequest;
  if (NativeXhr) {
    const currentSend = NativeXhr.prototype.send;
    NativeXhr.prototype.send = function(...args) {
      try {
        releaseRejectedAuthorization(this.__homepanelHeaders?.authorization || '');
      } catch (_) {}
      const result = currentSend.apply(this, args);
      rememberAcceptedAuthorization();
      return result;
    };
  }
)JS";
  static constexpr std::wstring_view kXhrCaptureFixed = LR"JS(  const NativeXhr = window.XMLHttpRequest;
  if (NativeXhr) {
    const currentSend = NativeXhr.prototype.send;
    NativeXhr.prototype.send = function(...args) {
      let candidate = null;
      try {
        if (trustedStationheadRequest(this.__homepanelUrl)) {
          candidate = candidateFromHeaders(
            new Headers(this.__homepanelHeaders || {}));
        }
        if (candidate) {
          this.addEventListener('loadend', () => {
            recordAuthorizationStatus(candidate, this.status);
          }, { once: true });
        }
      } catch (_) {}
      return currentSend.apply(this, args);
    };
  }
)JS";

  const bool acceptanceHelpersReplaced = ReplaceStationheadRuntimeFragment(
      script, kAcceptanceHelpers, kAcceptanceHelpersFixed);
  const bool fetchCaptureReplaced = ReplaceStationheadRuntimeFragment(
      script, kFetchCapture, kFetchCaptureFixed);
  const bool xhrCaptureReplaced = ReplaceStationheadRuntimeFragment(
      script, kXhrCapture, kXhrCaptureFixed);
  (void)acceptanceHelpersReplaced;
  (void)fetchCaptureReplaced;
  (void)xhrCaptureReplaced;
  return script;
}

}  // namespace hp

#undef StationheadAuthCaptureScript
#define StationheadAuthCaptureScript \
  StationheadAuthCaptureScriptResponseValidated
