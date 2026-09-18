#pragma once

#include "sh_process_failure_policy_fix.h"

namespace hp {
namespace stationhead_auth_process_failure_policy {

// Only process exits that invalidate the top-level browser/renderer are
// immediately fatal. Renderer-unresponsive is confirmed by the shared
// Stationhead classifier before the existing teardown handler is invoked.
inline bool IsCriticalStationheadProcessFailure(
    COREWEBVIEW2_PROCESS_FAILED_KIND kind) noexcept {
  switch (kind) {
    case COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED:
    case COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED:
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
        if (!args || FAILED(args->get_ProcessFailedKind(&kind))) {
          return stationhead_webview_policy::InvokeEventNoexcept(
              inner, sender, args);
        }

        const bool spotifyAuthorization =
            IsSpotifyAuthorizationProcessSource(sender);
        const bool unresponsive =
            kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE;

        // OAuth subframe/GPU/utility failures should not close the interactive
        // authorization surface. Playback uses the same rule: transient child
        // failures are left to WebView2 and the continuous audio-health monitor.
        if (spotifyAuthorization &&
            !IsCriticalStationheadProcessFailure(kind) && !unresponsive) {
          return S_OK;
        }

        // Browser/renderer exits forward immediately. Renderer-unresponsive is
        // forwarded only after two events from the same WebView within the
        // shared 15-second window. All other playback-process failures are
        // absorbed instead of starting an independent WebView recreation.
        if (!stationhead_process_failure_policy::
                ShouldForwardStationheadProcessFailure(sender, args)) {
          return S_OK;
        }

        return stationhead_webview_policy::InvokeEventNoexcept(
            inner, sender, args);
      });
}

}  // namespace stationhead_auth_process_failure_policy
}  // namespace hp

// Final ProcessFailed registration policy. Playback and Spotify-auth surfaces
// share one classifier, so transient child failures cannot bypass the base
// exception-containment policy or independently recreate the WebView.
#undef add_ProcessFailed
#define add_ProcessFailed(handler, token)                                        \
  add_ProcessFailed(                                                            \
      ::hp::stationhead_auth_process_failure_policy::                            \
          WrapStationheadAuthStableProcessFailedHandler((handler)).Get(),        \
      (token))

#include "sh_auth_completion_message_policy_fix.h"
