#pragma once
#include "sh_runtime_script_resource_policy_fix.h"

namespace hp {

// Keep authenticated account and playback-control data outside every optional
// resource-blocking rule. These requests are small JSON/control calls; blocking
// them saves negligible bandwidth but can prevent the page from establishing the
// account context used by /me/channel/{id}/streakStats.
inline constexpr bool StationheadDataAcquisitionRequestBoundaryFixed(
    std::wstring_view uriLower) {
  const StationheadRuntimeUriParts uri = StationheadParseRuntimeUri(uriLower);
  if (!uri.valid || uri.scheme != L"https" ||
      uri.host != L"production1.stationhead.com") {
    return false;
  }

  if (uri.path.starts_with(L"/me/")) return true;
  if (uri.path == L"/account" || uri.path.starts_with(L"/account/")) return true;
  if (uri.path == L"/timestamp" ||
      uri.path == L"/pusher/presenceauth") {
    return true;
  }
  return uri.path.find(L"/channels/alias/") != std::wstring_view::npos;
}

// SelectedGIF is not a self-contained decorative module. The live bundle also
// exposes account/chat/thread helpers from the same module. Replacing the whole
// module with a shape-only stub can leave playback visible while preventing the
// authenticated account state required by streakStats from being initialized.
// Continue stubbing the independently audited Lottie and Tooltip modules.
inline constexpr std::string_view
StationheadDataSafeOptionalModuleStubBoundaryFixed(
    std::wstring_view uriLower) {
  const StationheadRuntimeUriParts uri = StationheadParseRuntimeUri(uriLower);
  if (uri.valid && uri.scheme == L"https" &&
      StationheadRuntimeHostMatches(uri.host, L"stationhead.com") &&
      StationheadHashedAssetModulePathMatches(uri.path, L"selectedgif")) {
    return {};
  }
  return StationheadKnownOptionalModuleStubBoundaryFixed(uriLower);
}

static_assert(StationheadDataAcquisitionRequestBoundaryFixed(
    L"https://production1.stationhead.com/me/channel/318/streakstats"));
static_assert(StationheadDataAcquisitionRequestBoundaryFixed(
    L"https://production1.stationhead.com/me/country"));
static_assert(StationheadDataAcquisitionRequestBoundaryFixed(
    L"https://production1.stationhead.com/account?ids=1&channelid=318"));
static_assert(StationheadDataAcquisitionRequestBoundaryFixed(
    L"https://production1.stationhead.com/channels/alias/sakuramankai"));
static_assert(!StationheadDataAcquisitionRequestBoundaryFixed(
    L"https://production1.stationhead.com/chathistory"));
static_assert(!StationheadDataAcquisitionRequestBoundaryFixed(
    L"https://stationhead.com.evil.example/me/channel/318/streakstats"));
static_assert(StationheadDataSafeOptionalModuleStubBoundaryFixed(
    L"https://www.stationhead.com/assets/selectedgif-baax9j6x.js").empty());
static_assert(!StationheadDataSafeOptionalModuleStubBoundaryFixed(
    L"https://www.stationhead.com/assets/lottieanimationviewnonlazy-ve60c2no.js").empty());
static_assert(!StationheadDataSafeOptionalModuleStubBoundaryFixed(
    L"https://www.stationhead.com/assets/tooltip-cxafiwy6.js").empty());

// Final resource policy: preserve the existing image/font/telemetry/social/media
// reductions, but fail open for authenticated data acquisition and for the mixed
// SelectedGIF/account module.
inline void ApplyStationheadResourceBlockingDataSafe(
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

              const bool protectedData =
                  StationheadDataAcquisitionRequestBoundaryFixed(lower);
              if (!protectedData) {
                if (hasContext &&
                    context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT) {
                  moduleStub =
                      StationheadDataSafeOptionalModuleStubBoundaryFixed(lower);
                  if (!moduleStub.empty()) {
                    block = true;
                  } else {
                    emptyScript =
                        StationheadRequestIsBlockableBoundaryFixed(lower) ||
                        StationheadExpandedNonPlaybackScriptBoundaryFixed(lower);
                    block = emptyScript;
                  }
                } else {
                  block = StationheadRequestIsBlockableBoundaryFixed(lower);
                }
                if (!block && blockImages &&
                    StationheadRequestLooksLikeImage(lower)) {
                  block = true;
                  emptyResource = true;
                }
                if (!block && hasContext &&
                    context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA) {
                  block = !lower.empty() &&
                          !StationheadCorePlaybackRequestBoundaryFixed(lower);
                  emptyResource = block;
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
#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingDataSafe
