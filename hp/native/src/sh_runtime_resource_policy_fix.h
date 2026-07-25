#pragma once

namespace hp {

// The legacy additional blocker also registers the legacy blank-page recovery
// script. Keep only its script-resource filtering; the fixed recovery policy is
// composed once by StationheadAutoplayScriptRuntimeFixed.
inline void ApplyStationheadAdditionalScriptBlockingRuntimeFixed(
    ICoreWebView2Environment* environment,
    ICoreWebView2* webview) {
  if (!environment || !webview) return;
  webview->AddWebResourceRequestedFilter(
      L"https://stationhead.com/*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT);
  webview->AddWebResourceRequestedFilter(
      L"https://*.stationhead.com/*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT);

  ComPtr<ICoreWebView2Environment> env = environment;
  EventRegistrationToken ignoredToken{};
  webview->add_WebResourceRequested(
      Callback<ICoreWebView2WebResourceRequestedEventHandler>(
          [env](ICoreWebView2*,
                ICoreWebView2WebResourceRequestedEventArgs* args) -> HRESULT {
            if (!args) return S_OK;
            COREWEBVIEW2_WEB_RESOURCE_CONTEXT context =
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL;
            if (FAILED(args->get_ResourceContext(&context)) ||
                context != COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT) {
              return S_OK;
            }
            ComPtr<ICoreWebView2WebResourceRequest> request;
            if (FAILED(args->get_Request(&request)) || !request) return S_OK;
            LPWSTR uriRaw = nullptr;
            if (FAILED(request->get_Uri(&uriRaw)) || !uriRaw) return S_OK;
            const std::wstring uriLower = StationheadLowerAscii(uriRaw);
            CoTaskMemFree(uriRaw);
            if (!StationheadAdditionalNonPlaybackScriptUrl(uriLower)) return S_OK;

            ComPtr<ICoreWebView2WebResourceResponse> response;
            if (SUCCEEDED(env->CreateWebResourceResponse(
                    nullptr, 403, L"Blocked non-playback script",
                    L"Content-Type: application/javascript; charset=utf-8",
                    &response))) {
              args->put_Response(response.Get());
            }
            return S_OK;
          }).Get(),
      &ignoredToken);
}

// Final resource policy. No callback borrows StationheadPlayer state, and no
// legacy blank-page script is registered through the resource setup path.
inline void ApplyStationheadResourceBlockingFinalFixed(
    ICoreWebView2Environment* environment,
    ICoreWebView2* webview,
    const StationheadConfig& config,
    std::atomic<bool>& armed,
    EventRegistrationToken& token) {
  (void)armed;
  if (!environment || !webview) return;
  webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE);
  webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT);
  webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_STYLESHEET);
  webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA);
  webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT);
  webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST);
  webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH);
  webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_TEXT_TRACK);
  webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_EVENT_SOURCE);
  webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_WEBSOCKET);
  webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MANIFEST);
  webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_PING);
  webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_CSP_VIOLATION_REPORT);

  const bool blockImages = config.blockImages;
  const bool blockFonts = config.blockFonts;
  ComPtr<ICoreWebView2Environment> env = environment;
  webview->add_WebResourceRequested(
      Callback<ICoreWebView2WebResourceRequestedEventHandler>(
          [env, blockImages, blockFonts](
              ICoreWebView2*,
              ICoreWebView2WebResourceRequestedEventArgs* args) -> HRESULT {
            if (!args) return S_OK;
            COREWEBVIEW2_WEB_RESOURCE_CONTEXT context =
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL;
            const bool hasContext = SUCCEEDED(args->get_ResourceContext(&context));
            bool block = false;
            bool needsUri = true;
            if (hasContext) {
              if ((blockImages && context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE) ||
                  (blockFonts && context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT) ||
                  context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_TEXT_TRACK ||
                  context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MANIFEST ||
                  context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_CSP_VIOLATION_REPORT) {
                block = true;
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
              block = StationheadRequestIsBlockable(lower);
              if (!block && blockImages && StationheadRequestLooksLikeImage(lower)) {
                block = true;
              }
              if (!block && hasContext &&
                  context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA) {
                block = !lower.empty() && !StationheadCorePlaybackRequest(lower);
              }
            }
            if (block) {
              ComPtr<ICoreWebView2WebResourceResponse> response;
              if (SUCCEEDED(env->CreateWebResourceResponse(
                      nullptr, 403, L"Blocked", L"", &response))) {
                args->put_Response(response.Get());
              }
            }
            return S_OK;
          }).Get(),
      &token);

  BlockStationheadTelemetrySockets(webview, config.blockImages);
  ApplyStationheadNonPlaybackScriptBlocking(environment, webview);
  ApplyStationheadAdditionalScriptBlockingRuntimeFixed(environment, webview);
}

}  // namespace hp

#undef ApplyStationheadResourceBlocking
#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingFinalFixed
