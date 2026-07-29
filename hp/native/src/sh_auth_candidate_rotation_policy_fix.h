#pragma once

namespace hp {

// The response-validation layer introduced on 2026-07-27 pinned the first
// successful Authorization value for the lifetime of a document. Stationhead
// can issue more than one page-owned Authorization value during startup; when
// an account-scoped token arrived after an earlier successful candidate, the
// guard discarded it and streakStats kept using the wrong account context.
//
// Preserve response validation and explicit-401 rejection, but restore the
// pre-regression latest-candidate behavior. A monotonically increasing dispatch
// order prevents a late response from an older request from overwriting a newer
// validated candidate. The order marker is non-enumerable, so it is never sent
// back to Stationhead as a request header.
inline std::wstring StationheadAuthCaptureScriptValidatedRotation() {
  std::wstring script = StationheadAuthCaptureScript();

  static constexpr std::wstring_view kPinnedCandidatePolicy = LR"JS(  const candidateFromHeaders = headers => {
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
    if (window.__homepanelStationheadRejectedAuthorization ===
          candidate.authorization &&
        window.__homepanelStationheadBlockingLoginVisible !== false) {
      return;
    }
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
)JS";

  static constexpr std::wstring_view kRotatingCandidatePolicy = LR"JS(  let nextCandidateOrder = 0;
  let acceptedCandidateOrder = 0;
  const candidateFromHeaders = headers => {
    const authorization = headers?.get?.('authorization') || '';
    if (!authorization) return null;
    const candidate = {
      authorization,
      'sth-device-uid': headers.get('sth-device-uid') || '',
      'app-platform': headers.get('app-platform') || 'web',
      'app-version': headers.get('app-version') || '1.0.0',
    };
    try {
      Object.defineProperty(candidate, '__homepanelCaptureOrder', {
        value: ++nextCandidateOrder,
      });
    } catch (_) {
      candidate.__homepanelCaptureOrder = ++nextCandidateOrder;
    }
    return candidate;
  };
  const acceptAuthorizationCandidate = candidate => {
    if (!candidate?.authorization) return;
    if (window.__homepanelStationheadRejectedAuthorization ===
          candidate.authorization &&
        window.__homepanelStationheadBlockingLoginVisible !== false) {
      return;
    }
    const candidateOrder = Number(candidate.__homepanelCaptureOrder || 0);
    if (candidateOrder > 0 && candidateOrder < acceptedCandidateOrder) return;
    const current = window.__homepanelStationheadAuthHeaders;
    const changed = current?.authorization !== candidate.authorization;
    acceptedCandidateOrder = Math.max(acceptedCandidateOrder, candidateOrder);
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
)JS";

  const bool candidateRotationReplaced = ReplaceStationheadRuntimeFragment(
      script, kPinnedCandidatePolicy, kRotatingCandidatePolicy);
  (void)candidateRotationReplaced;
  return script;
}

}  // namespace hp

#undef StationheadAuthCaptureScript
#define StationheadAuthCaptureScript \
  StationheadAuthCaptureScriptValidatedRotation
