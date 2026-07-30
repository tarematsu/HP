#pragma once
#include "sh_startup_resource_reduction_policy_fix.h"

namespace hp {

// Stationhead may move audio between Spotify/CDN hosts without changing the
// visible page bundle. WebView2's MEDIA context does not identify whether a
// request is decorative or audible, so it must remain fail-open. The station
// listener control is also part of joining/maintaining playback, not optional
// chat UI, even though the older social-path classifier includes it.
inline constexpr bool StationheadPlaybackControlRequestBoundaryFixed(
    std::wstring_view uriLower) {
  const StationheadRuntimeUriParts uri = StationheadParseRuntimeUri(uriLower);
  if (!uri.valid || uri.scheme != L"https" ||
      uri.host != L"production1.stationhead.com") {
    return false;
  }
  return uri.path == L"/station" || uri.path.starts_with(L"/station/") ||
         uri.path == L"/listener" || uri.path.starts_with(L"/listener/") ||
         uri.path == L"/playback" || uri.path.starts_with(L"/playback/") ||
         uri.path == L"/stream" || uri.path.starts_with(L"/stream/");
}

static_assert(StationheadPlaybackControlRequestBoundaryFixed(
    L"https://production1.stationhead.com/station/318/listener"));
static_assert(StationheadPlaybackControlRequestBoundaryFixed(
    L"https://production1.stationhead.com/playback/session"));
static_assert(!StationheadPlaybackControlRequestBoundaryFixed(
    L"https://production1.stationhead.com/chathistory"));
static_assert(!StationheadPlaybackControlRequestBoundaryFixed(
    L"https://production1.stationhead.com.evil.example/station/318/listener"));

// The public shell and the authenticated station route are assembled from the
// same hash-versioned module graph. Replacing those modules with hard-coded
// minified export maps is unsafe across deployments and account-specific feature
// flags: one missing export can leave the persistent header mounted while the
// route body fails to render. Keep every Stationhead-owned UI/API request open.
inline constexpr bool StationheadOwnedRequestBoundaryFixed(
    std::wstring_view uriLower) {
  const StationheadRuntimeUriParts uri = StationheadParseRuntimeUri(uriLower);
  return uri.valid && uri.scheme == L"https" &&
         StationheadRuntimeHostMatches(uri.host, L"stationhead.com");
}

static_assert(StationheadOwnedRequestBoundaryFixed(
    L"https://www.stationhead.com/assets/SelectedGIF-next1234.js"));
static_assert(StationheadOwnedRequestBoundaryFixed(
    L"https://production1.stationhead.com/chathistory"));
static_assert(StationheadOwnedRequestBoundaryFixed(
    L"https://realtime-production.stationhead.com/app/key"));
static_assert(!StationheadOwnedRequestBoundaryFixed(
    L"https://stationhead.com.evil.example/assets/main.js"));
static_assert(!StationheadOwnedRequestBoundaryFixed(
    L"https://cdn.example.com/assets/main.js"));

inline void ApplyStationheadResourceBlockingPlaybackSafe(
    ICoreWebView2Environment* environment,
    ICoreWebView2* webview,
    const StationheadConfig& config,
    std::atomic<bool>& armed,
    EventRegistrationToken& token) {
  (void)config;
  if (!environment || !webview) return;

  // Preserve the July 23 controller-lifecycle cache policy after replacing its
  // resource handler: clear only Chromium's browser cache once per newly created
  // playback controller. Cookies and DOM storage remain intact, so Stationhead
  // login and Spotify authorization survive the reset.
  webview->CallDevToolsProtocolMethod(L"Network.enable", L"{}", nullptr);
  webview->CallDevToolsProtocolMethod(
      L"Network.clearBrowserCache", L"{}", nullptr);

  ComPtr<ICoreWebView2> base = webview;
  ComPtr<ICoreWebView2_22> sourceAwareWebView;
  base.As(&sourceAwareWebView);
  auto sourceKinds = COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_DOCUMENT;
  if (StationheadOwnsWorkerRequestFilters(webview)) {
    sourceKinds = static_cast<COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS>(
        sourceKinds |
        COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_SHARED_WORKER |
        COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_SERVICE_WORKER);
  }
  const auto addFilter = [&](COREWEBVIEW2_WEB_RESOURCE_CONTEXT context) {
    AddStationheadResourceFilter(
        webview, sourceAwareWebView.Get(), context, sourceKinds);
  };

  // Do not intercept images, fonts, stylesheets, media, text tracks, or
  // manifests here. In particular, same-origin UI modules and APIs must remain
  // fail-open. After native audio is stable, retain only explicit third-party
  // telemetry suppression.
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_EVENT_SOURCE);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_WEBSOCKET);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_PING);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_CSP_VIOLATION_REPORT);

  ComPtr<ICoreWebView2Environment> env = environment;
  std::atomic<bool>* const armedState = &armed;
  webview->add_WebResourceRequested(
      Callback<ICoreWebView2WebResourceRequestedEventHandler>(
          [env, armedState](
              ICoreWebView2*,
              ICoreWebView2WebResourceRequestedEventArgs* args) -> HRESULT {
            if (!args ||
                !armedState->load(std::memory_order_acquire)) {
              return S_OK;
            }

            COREWEBVIEW2_WEB_RESOURCE_CONTEXT context =
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL;
            const bool hasContext =
                SUCCEEDED(args->get_ResourceContext(&context));
            std::wstring lower;
            ComPtr<ICoreWebView2WebResourceRequest> request;
            if (SUCCEEDED(args->get_Request(&request)) && request) {
              LPWSTR uriRaw = nullptr;
              if (SUCCEEDED(request->get_Uri(&uriRaw)) && uriRaw) {
                lower = StationheadLowerAscii(uriRaw);
                CoTaskMemFree(uriRaw);
              }
            }

            if (lower.empty() ||
                StationheadOwnedRequestBoundaryFixed(lower) ||
                !StationheadTelemetryRequestBoundaryFixed(lower)) {
              return S_OK;
            }

            const bool script = hasContext &&
                context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT;
            ComPtr<ICoreWebView2WebResourceResponse> response;
            const int status = script ? 200 : 204;
            const wchar_t* reason = script ? L"OK" : L"No Content";
            const wchar_t* headers = script
                ? L"Content-Type: application/javascript; charset=utf-8\r\n"
                  L"Content-Length: 0\r\n"
                  L"Cache-Control: public, max-age=31536000, immutable"
                : L"Content-Length: 0\r\n"
                  L"Cache-Control: public, max-age=31536000, immutable";
            if (SUCCEEDED(env->CreateWebResourceResponse(
                    nullptr, status, reason, headers, &response))) {
              args->put_Response(response.Get());
            }
            return S_OK;
          }).Get(),
      &token);
}

}  // namespace hp

#undef ApplyStationheadResourceBlocking
#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingPlaybackSafe
