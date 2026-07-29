#pragma once
#include "sh_data_acquisition_resource_policy_fix.h"

namespace hp {

inline constexpr std::string_view kStationheadSvgIconNonLazyModuleStub =
    "export const SVGIconNonLazy=()=>null;";
inline constexpr std::string_view kStationheadPremiumIconModuleStub =
    "export{};";

inline constexpr std::string_view
StationheadStartupOptionalModuleStubBoundaryFixed(std::wstring_view uriLower) {
  const StationheadRuntimeUriParts uri = StationheadParseRuntimeUri(uriLower);
  if (!uri.valid || uri.scheme != L"https" ||
      !StationheadRuntimeHostMatches(uri.host, L"stationhead.com")) {
    return {};
  }
  // SVGIconNonLazy is a switch over decorative React SVG components. Vite's
  // preload map requests premium-20 before evaluating that wrapper, so replace
  // both assets locally: the wrapper becomes a null component and its icon pack
  // becomes an empty ES module. The audited module graph has no executable
  // premium-20 importer other than the wrapper being replaced here.
  if (StationheadHashedAssetModulePathMatches(
          uri.path, L"svgiconnonlazy")) {
    return kStationheadSvgIconNonLazyModuleStub;
  }
  if (StationheadHashedAssetModulePathMatches(uri.path, L"premium-20")) {
    return kStationheadPremiumIconModuleStub;
  }
  return StationheadKnownOptionalModuleStubBoundaryFixed(uriLower);
}

static_assert(StationheadStartupOptionalModuleStubBoundaryFixed(
                  L"https://www.stationhead.com/assets/svgiconnonlazy-ui-053mu.js") ==
              kStationheadSvgIconNonLazyModuleStub);
static_assert(StationheadStartupOptionalModuleStubBoundaryFixed(
                  L"https://www.stationhead.com/assets/svgiconnonlazy-next1234.mjs") ==
              kStationheadSvgIconNonLazyModuleStub);
static_assert(StationheadStartupOptionalModuleStubBoundaryFixed(
                  L"https://www.stationhead.com/assets/premium-20-iq2c1wiz.js") ==
              kStationheadPremiumIconModuleStub);
static_assert(StationheadStartupOptionalModuleStubBoundaryFixed(
                  L"https://www.stationhead.com/assets/selectedgif-baax9j6x.js") ==
              kSelectedGifModuleStub);
static_assert(StationheadStartupOptionalModuleStubBoundaryFixed(
    L"https://stationhead.com.evil.example/assets/svgiconnonlazy-ui-053mu.js").empty());
static_assert(StationheadStartupOptionalModuleStubBoundaryFixed(
    L"https://www.stationhead.com/nested/assets/premium-20-iq2c1wiz.js").empty());

inline constexpr bool StationheadOptionalStylesheetBoundaryFixed(
    std::wstring_view uriLower) {
  const StationheadRuntimeUriParts uri = StationheadParseRuntimeUri(uriLower);
  if (!uri.valid || uri.scheme != L"https" ||
      !StationheadRuntimeHostMatches(uri.host, L"stationhead.com")) {
    return false;
  }

  constexpr std::wstring_view kPrefix = L"/assets/tooltip-";
  constexpr std::wstring_view kExtension = L".css";
  if (!uri.path.starts_with(kPrefix) || !uri.path.ends_with(kExtension)) {
    return false;
  }
  const std::wstring_view hash = uri.path.substr(
      kPrefix.size(), uri.path.size() - kPrefix.size() - kExtension.size());
  if (hash.size() < 6) return false;
  for (const wchar_t character : hash) {
    const bool allowed = (character >= L'a' && character <= L'z') ||
                         (character >= L'0' && character <= L'9') ||
                         character == L'-' || character == L'_';
    if (!allowed) return false;
  }
  return true;
}

static_assert(StationheadOptionalStylesheetBoundaryFixed(
    L"https://www.stationhead.com/assets/tooltip-u7w9wxcq.css"));
static_assert(StationheadOptionalStylesheetBoundaryFixed(
    L"https://stationhead.com/assets/tooltip-next_12.css"));
static_assert(!StationheadOptionalStylesheetBoundaryFixed(
    L"https://www.stationhead.com/assets/tooltip.css"));
static_assert(!StationheadOptionalStylesheetBoundaryFixed(
    L"https://www.stationhead.com/nested/assets/tooltip-u7w9wxcq.css"));
static_assert(!StationheadOptionalStylesheetBoundaryFixed(
    L"https://stationhead.com.evil.example/assets/tooltip-u7w9wxcq.css"));

// Keep authenticated account/statistics requests fail-open, but restore the
// audited SelectedGIF module stub now that statistics session acquisition is
// independent of that mixed UI bundle. Tooltip CSS is also unnecessary after
// the child-preserving Tooltip JavaScript stub is installed.
inline void ApplyStationheadResourceBlockingStartupReduced(
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
  addFilter(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_STYLESHEET);
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
                      StationheadStartupOptionalModuleStubBoundaryFixed(lower);
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
#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingStartupReduced
#undef StationheadKnownOptionalModuleStubBoundaryFixed
#define StationheadKnownOptionalModuleStubBoundaryFixed \
  StationheadStartupOptionalModuleStubBoundaryFixed
