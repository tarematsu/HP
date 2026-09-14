#pragma once

namespace hp {

// Preserve the most recently accepted Stationhead authorization across a
// transient login-surface false positive. Response validation in the later auth
// policy decides whether a candidate is actually reusable.
inline std::wstring StationheadAuthCaptureScriptRuntimeFixed() {
  std::wstring script = StationheadAuthCaptureScript();
  script.append(LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if ((host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) ||
      window.top !== window) return;
  if (window.__homepanelStationheadAuthReuseFix) return;
  window.__homepanelStationheadAuthReuseFix = true;
  const rememberAcceptedAuthorization = () => {
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
  const currentFetch = window.fetch ? window.fetch.bind(window) : null;
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
  const NativeXhr = window.XMLHttpRequest;
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
})()
)JS");
  return script;
}

}  // namespace hp

#undef StationheadAuthCaptureScript
#define StationheadAuthCaptureScript StationheadAuthCaptureScriptRuntimeFixed
