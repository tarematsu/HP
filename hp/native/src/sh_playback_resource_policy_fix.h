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

inline void ApplyStationheadResourceBlockingPlaybackSafe(
    ICoreWebView2Environment* environment,
    ICoreWebView2* webview,
    const StationheadConfig& config,
    std::atomic<bool>& armed,
    EventRegistrationToken& token) {
  (void)armed;
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

  const bool blockImages = config.blockImages;
  const bool blockFonts = config.blockFonts;
  if (blockImages) addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE);
  if (blockFonts) addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_STYLESHEET);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_TEXT_TRACK);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_EVENT_SOURCE);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_WEBSOCKET);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MANIFEST);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_PING);
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_CSP_VIOLATION_REPORT);

  ComPtr<ICoreWebView2Environment> env = environment;
  webview->add_WebResourceRequested(
      Callback<ICoreWebView2WebResourceRequestedEventHandler>(
          [env, blockImages, blockFonts](
              ICoreWebView2*,
              ICoreWebView2WebResourceRequestedEventArgs* args) -> HRESULT {
            if (!args) return S_OK;
            COREWEBVIEW2_WEB_RESOURCE_CONTEXT context =
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL;
            const bool hasContext =
                SUCCEEDED(args->get_ResourceContext(&context));
            bool block = false;
            bool emptyScript = false;
            bool emptyResource = false;
            std::string_view moduleStub;
            bool needsUri = true;
            if (hasContext) {
              if ((blockImages && context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE) ||
                  (blockFonts && context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT) ||
                  context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_TEXT_TRACK ||
                  context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MANIFEST ||
                  context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_PING ||
                  context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_CSP_VIOLATION_REPORT) {
                block = true;
                emptyResource = true;
                needsUri = false;
              }
            }
            if (needsUri) {
              std::wstring lower;
              ComPtr<ICoreWebView2WebResourceRequest> request;
              if (SUCCEEDED(args->get_Request(&request)) && request) {
                LPWSTR uriRaw = nullptr;
                if (SUCCEEDED(request->get_Uri(&uriRaw)) && uriRaw) {
                  lower = StationheadLowerAscii(uriRaw);
                  CoTaskMemFree(uriRaw);
                }
              }

              const bool protectedRequest =
                  StationheadDataAcquisitionRequestBoundaryFixed(lower) ||
                  StationheadPlaybackControlRequestBoundaryFixed(lower);
              if (!protectedRequest) {
                if (hasContext &&
                    context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT) {
                  moduleStub =
                      StationheadKnownOptionalModuleStubBoundaryFixed(lower);
                  if (!moduleStub.empty()) {
                    block = true;
                  } else {
                    emptyScript =
                        StationheadRequestIsBlockableBoundaryFixed(lower) ||
                        StationheadExpandedNonPlaybackScriptBoundaryFixed(lower);
                    block = emptyScript;
                  }
                } else if (hasContext &&
                           context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_STYLESHEET) {
                  block = StationheadOptionalStylesheetBoundaryFixed(lower);
                  emptyResource = block;
                } else {
                  block = StationheadRequestIsBlockableBoundaryFixed(lower);
                }
                if (!block && blockImages &&
                    StationheadRequestLooksLikeImage(lower)) {
                  block = true;
                  emptyResource = true;
                }
              }
            }
            if (block) {
              const bool replacementScript =
                  emptyScript || !moduleStub.empty();
              ComPtr<IStream> responseBody;
              if (!moduleStub.empty()) {
                responseBody.Attach(SHCreateMemStream(
                    reinterpret_cast<const BYTE*>(moduleStub.data()),
                    static_cast<UINT>(moduleStub.size())));
                if (!responseBody) return S_OK;
              }
              ComPtr<ICoreWebView2WebResourceResponse> response;
              const int status =
                  replacementScript ? 200 : (emptyResource ? 204 : 403);
              const wchar_t* reason = replacementScript
                  ? L"OK"
                  : (emptyResource ? L"No Content" : L"Blocked");
              const wchar_t* headers = replacementScript
                  ? L"Content-Type: application/javascript; charset=utf-8\r\n"
                    L"Cache-Control: public, max-age=31536000, immutable"
                  : (emptyResource
                         ? L"Content-Length: 0\r\n"
                           L"Cache-Control: public, max-age=31536000, immutable"
                         : L"");
              if (SUCCEEDED(env->CreateWebResourceResponse(
                      responseBody.Get(), status, reason, headers, &response))) {
                args->put_Response(response.Get());
              }
            }
            return S_OK;
          }).Get(),
      &token);

  BlockStationheadTelemetrySocketsBoundaryFixed(webview);
}

}  // namespace hp

#undef ApplyStationheadResourceBlocking
#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingPlaybackSafe
