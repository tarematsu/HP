#pragma once

namespace hp {
namespace stationhead_auth_navigation_policy {

// OAuth providers commonly supersede an about:blank or intermediate Spotify
// navigation while the next redirect is already in flight. WebView2 reports the
// displaced navigation as OPERATION_CANCELED. Treating that completion as a hard
// failure closes the auth controller underneath the valid redirect and leaves
// Stationhead asking the user to connect again.
//
// Suppress only this one cancellation class, and only for an auth-shaped route:
// about:blank, a trusted Spotify origin, or a trusted Stationhead callback after
// this controller has already visited Spotify. Playback navigations never gain
// the Spotify-flow latch, so their failures still reach the existing recovery
// handler unchanged.
inline ComPtr<ICoreWebView2NavigationCompletedEventHandler>
WrapStationheadAuthStableNavigationCompletedHandler(
    ICoreWebView2NavigationCompletedEventHandler* handler) noexcept {
  if (!handler) return {};
  ComPtr<ICoreWebView2NavigationCompletedEventHandler> inner = handler;
  return Callback<ICoreWebView2NavigationCompletedEventHandler>(
      [inner = std::move(inner), observedSpotifyOrigin = false](
          ICoreWebView2* sender,
          ICoreWebView2NavigationCompletedEventArgs* args) mutable noexcept
          -> HRESULT {
        if (!inner || !sender || !args) return S_OK;

        LPWSTR currentSource = nullptr;
        const HRESULT sourceResult = sender->get_Source(&currentSource);
        bool aboutBlank = false;
        bool spotifySource = false;
        bool stationheadSource = false;
        if (SUCCEEDED(sourceResult) && currentSource) {
          aboutBlank = stationhead_webview_policy::IsAboutBlank(currentSource);
          stationhead_webview_policy::WebOriginView origin;
          if (stationhead_webview_policy::IsTrustedMessageUri(
                  currentSource, origin)) {
            spotifySource =
                stationhead_webview_policy::IsSpotifyHost(origin.host);
            stationheadSource =
                stationhead_webview_policy::IsStationheadHost(origin.host);
          }
        }
        if (currentSource) CoTaskMemFree(currentSource);
        if (spotifySource) observedSpotifyOrigin = true;

        BOOL success = FALSE;
        COREWEBVIEW2_WEB_ERROR_STATUS webError =
            COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
        const bool hasFailure =
            SUCCEEDED(args->get_IsSuccess(&success)) && success == FALSE &&
            SUCCEEDED(args->get_WebErrorStatus(&webError));
        const bool authRedirectWasSuperseded =
            hasFailure &&
            webError == COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED &&
            (aboutBlank || spotifySource ||
             (observedSpotifyOrigin && stationheadSource));
        if (authRedirectWasSuperseded) return S_OK;

        return stationhead_webview_policy::InvokeEventNoexcept(
            inner, sender, args);
      });
}

// The playback controller already receives a 30-second creation watchdog. Give
// the transient authorization controller the same allowance so a slow machine
// or profile initialization does not cancel an otherwise valid login at 20s.
inline constexpr int64_t kAuthControllerStableTimeoutMs = 30'000;
static_assert(kAuthControllerStableTimeoutMs >=
              kStationheadAuthControllerTimeoutMs);
static_assert(kAuthControllerStableTimeoutMs <=
              kStationheadWebViewCreationTimeoutMs);

}  // namespace stationhead_auth_navigation_policy
}  // namespace hp

// This is the final NavigationCompleted registration policy. It preserves the
// existing exception boundary while adding auth-only redirect cancellation
// tolerance.
#undef add_NavigationCompleted
#define add_NavigationCompleted(handler, token)                                  \
  add_NavigationCompleted(                                                       \
      ::hp::stationhead_auth_navigation_policy::                                 \
          WrapStationheadAuthStableNavigationCompletedHandler((handler)).Get(),  \
      (token))

// Keep the original shared constant for source compatibility and redirect only
// native timeout uses compiled after this final PCH layer.
#define kStationheadAuthControllerTimeoutMs                                      \
  ::hp::stationhead_auth_navigation_policy::kAuthControllerStableTimeoutMs

#include "sh_auth_capture_validation_policy_fix.h"
