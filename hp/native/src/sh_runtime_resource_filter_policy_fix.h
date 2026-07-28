#pragma once
#include "sh_auth_navigation_policy_fix.h"

namespace hp {

inline void AddStationheadResourceFilter(
    ICoreWebView2* webview,
    ICoreWebView2_22* sourceAwareWebView,
    COREWEBVIEW2_WEB_RESOURCE_CONTEXT context,
    COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS sourceKinds) {
  HRESULT result = E_NOINTERFACE;
  if (sourceAwareWebView) {
    result = sourceAwareWebView->AddWebResourceRequestedFilterWithRequestSourceKinds(
        L"*", context, sourceKinds);
  }
  // Compatibility fallback for an older installed WebView2 Runtime. The
  // project SDK exposes ICoreWebView2_22, but the evergreen runtime can lag.
  if (FAILED(result) && webview) {
    webview->AddWebResourceRequestedFilter(L"*", context);
  }
}

// The strict resource boundary no longer applies an armed stylesheet rule, so
// routing every CSS response through WebResourceRequested only performs COM URI
// extraction and lowercasing without changing the response. Register optional
// image/font contexts only when their configured policy is active, and reject
// hyperlink-audit pings directly because they cannot carry playback or auth.
//
// The legacy two-argument filter does not reliably cover cross-origin iframes
// and cannot subscribe to service/shared-worker requests. Use the source-kind
// API so Stationhead cannot bypass the blocker by moving fetches into a worker.
// Register the complete current source mask on both playback WebViews. WebView2
// can deliver a service/shared-worker request to both handlers, but their policy
// and replacement response are identical, so the decision is idempotent. This
// deliberately avoids a gap while Primary is still creating or being rebuilt:
// Secondary keeps worker blocking active instead of depending on a fixed owner.
inline void ApplyStationheadResourceBlockingFilterFixed(
    ICoreWebView2Environment* environment,
    ICoreWebView2* webview,
    const StationheadConfig& config,
    std::atomic<bool>& armed,
    EventRegistrationToken& token) {
  (void)armed;
  if (!environment || !webview) return;

  ComPtr<ICoreWebView2> base = webview;
  ComPtr<ICoreWebView2_22> sourceAwareWebView;
  base.As(&sourceAwareWebView);
  const auto sourceKinds =
      static_cast<COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS>(
          COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_DOCUMENT |
          COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_SHARED_WORKER |
          COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_SERVICE_WORKER);
  const auto addFilter = [&](COREWEBVIEW2_WEB_RESOURCE_CONTEXT context) {
    AddStationheadResourceFilter(
        webview, sourceAwareWebView.Get(), context, sourceKinds);
  };

  const bool blockImages = config.blockImages;
  const bool blockFonts = config.blockFonts;
  if (blockImages) {
    addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE);
  }
  if (blockFonts) {
    addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT);
  }
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA);
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
            bool needsUri = true;
            if (hasContext) {
              if ((blockImages &&
                   context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE) ||
                  (blockFonts &&
                   context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT) ||
                  context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_TEXT_TRACK ||
                  context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MANIFEST ||
                  context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_PING ||
                  context ==
                      COREWEBVIEW2_WEB_RESOURCE_CONTEXT_CSP_VIOLATION_REPORT) {
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
              block = StationheadRequestIsBlockableBoundaryFixed(lower);
              if (!block && hasContext &&
                  context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT) {
                block = StationheadNonPlaybackScriptUrlRuntimeFixed(lower) ||
                        StationheadAdditionalNonPlaybackScriptUrl(lower);
              }
              if (!block && blockImages &&
                  StationheadRequestLooksLikeImage(lower)) {
                block = true;
              }
              if (!block && hasContext &&
                  context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA) {
                block = !lower.empty() &&
                        !StationheadCorePlaybackRequestBoundaryFixed(lower);
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

  BlockStationheadTelemetrySocketsBoundaryFixed(webview);
}

}  // namespace hp

#undef ApplyStationheadResourceBlocking
#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingFilterFixed
