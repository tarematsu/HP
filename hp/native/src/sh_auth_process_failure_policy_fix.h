#pragma once

namespace hp {
namespace stationhead_auth_process_failure_policy {

// WebView2 distinguishes browser/main-renderer failures, which require explicit
// recovery, from subframe and auxiliary-process failures that can be logged or
// left to the runtime. The authorization controller previously closed the whole
// Spotify flow for every ProcessFailed kind, so a failed consent/captcha frame or
// transient GPU/utility process could discard an otherwise valid OAuth session.
inline bool IsCriticalStationheadProcessFailure(
    COREWEBVIEW2_PROCESS_FAILED_KIND kind) noexcept {
  switch (kind) {
    case COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED:
    case COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED:
    case COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE:
      return true;
    default:
      return false;
  }
}

inline bool IsSpotifyAuthorizationProcessSource(
    ICoreWebView2* sender) noexcept {
  if (!sender) return false;
  LPWSTR sourceRaw = nullptr;
  if (FAILED(sender->get_Source(&sourceRaw)) || !sourceRaw) return false;
  stationhead_webview_policy::WebOriginView origin;
  const bool trusted =
      stationhead_webview_policy::IsTrustedMessageUri(sourceRaw, origin);
  const bool spotify =
      trusted && stationhead_webview_policy::IsSpotifyHost(origin.host);
  CoTaskMemFree(sourceRaw);
  return spotify;
}

inline ComPtr<ICoreWebView2ProcessFailedEventHandler>
WrapStationheadAuthStableProcessFailedHandler(
    ICoreWebView2ProcessFailedEventHandler* handler) noexcept {
  if (!handler) return {};
  ComPtr<ICoreWebView2ProcessFailedEventHandler> inner = handler;
  return Callback<ICoreWebView2ProcessFailedEventHandler>(
      [inner = std::move(inner)](
          ICoreWebView2* sender,
          ICoreWebView2ProcessFailedEventArgs* args) noexcept -> HRESULT {
        if (!inner) return S_OK;
        COREWEBVIEW2_PROCESS_FAILED_KIND kind{};
        if (!args || FAILED(args->get_ProcessFailedKind(&kind)) ||
            IsCriticalStationheadProcessFailure(kind) ||
            !IsSpotifyAuthorizationProcessSource(sender)) {
          return stationhead_webview_policy::InvokeEventNoexcept(
              inner, sender, args);
        }

        // Keep the interactive OAuth controller alive for a Spotify subframe or
        // auxiliary-process failure. A later top-level renderer/browser failure
        // still reaches the existing teardown path unchanged.
        return S_OK;
      });
}

}  // namespace stationhead_auth_process_failure_policy
}  // namespace hp

// Final ProcessFailed registration policy. Playback and non-Spotify WebViews
// retain their existing handler behavior; only noncritical failures while the
// interactive controller is on a trusted Spotify origin are absorbed.
#undef add_ProcessFailed
#define add_ProcessFailed(handler, token)                                        \
  add_ProcessFailed(                                                            \
      ::hp::stationhead_auth_process_failure_policy::                            \
          WrapStationheadAuthStableProcessFailedHandler((handler)).Get(),        \
      (token))

#include "sh_auth_completion_message_policy_fix.h"
