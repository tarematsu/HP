#pragma once
#include "sh_runtime_resource_filter_policy_fix.h"

namespace hp {

inline constexpr std::wstring_view kNonPlaybackScriptDomains[] = {
    L"posthog.com",
    L"heapanalytics.com",
    L"heap.io",
    L"logrocket.com",
    L"logrocket.io",
    L"lr-ingest.com",
    L"smartlook.com",
    L"pendo.io",
    L"appcues.com",
    L"onetrust.com",
    L"cookielaw.org",
    L"trustarc.com",
    L"iubenda.com",
    L"zdassets.com",
    L"zendesk.com",
    L"helpscout.net",
    L"drift.com",
    L"driftcdn.com",
    L"crisp.chat",
    L"tawk.to",
    L"hs-scripts.com",
    L"hs-analytics.net",
    L"hubspot.com",
    L"mouseflow.com",
    L"sprig.com",
    L"userleap.com",
    // HomePanel uses Stationhead's Spotify path only. These identity SDKs were
    // observed on both live station pages and are independent of audio playback.
    L"appleid.cdn-apple.com",
    L"accounts.google.com",
};

// These lists are retained for the live audit's body-signal classification.
// They do not make a same-origin ES module blockable: Vite modules can expose
// named exports even when their filename describes an optional surface.
inline constexpr std::wstring_view kProtectedScriptNeedles[] = {
    L"player", L"playback", L"audio", L"media", L"stream",
    L"queue", L"realtime", L"pusher", L"presence",
    L"auth", L"login", L"session", L"account", L"spotify",
    L"station", L"channel", L"broadcast",
    L"runtime", L"framework", L"webpack", L"polyfill", L"main-app",
};

inline constexpr std::wstring_view kNonPlaybackScriptNeedles[] = {
    L"chat", L"comment", L"gift", L"tipping", L"trending", L"thread",
    L"reaction", L"emoji", L"listeners", L"audience", L"leaderboard",
    L"onboarding", L"walkthrough", L"tutorial", L"survey", L"feedback",
    L"rating-prompt", L"review-prompt", L"achievement", L"badge-modal",
    L"badges-page", L"milestone", L"quest", L"missions", L"rewards",
    L"streak-modal", L"ranking-page", L"rankings-page",
    L"moderation-panel", L"moderator-tools", L"creator-tools",
    L"host-tools", L"block-user", L"blocked-users", L"muted-users",
    L"report-modal", L"report-user",
    L"search-modal", L"explore-panel", L"discover", L"discovery",
    L"social-feed", L"activity-feed",
    L"notification", L"inbox", L"message-center", L"messages-panel",
    L"share-sheet", L"sharing", L"invite", L"referral", L"followers",
    L"following", L"follow-modal", L"audience-modal", L"listener-modal",
    L"listeners-modal",
    L"cookie-consent", L"consent-manager", L"privacy-policy",
    L"terms-of-service", L"legal-modal", L"help-center", L"help-modal",
    L"support-widget", L"contact-support",
    L"paywall", L"upsell", L"promo-banner", L"app-install",
    L"download-app", L"mobile-app-banner", L"push-prompt",
    L"subscription-modal", L"billing-modal", L"purchase-modal",
    L"checkout-modal", L"premium-modal", L"plus-modal", L"wallet-modal",
    L"merch-store", L"storefront", L"shop-modal",
    L"settings-modal", L"profile-edit", L"avatar-picker",
    L"apple-music", L"musickit", L"connect-apple", L"music-service",
    L"service-picker",
};

inline constexpr std::string_view kLottieModuleStub =
    "export const LottieAnimationViewNonLazy=()=>null;";
inline constexpr std::string_view kTooltipModuleStub =
    "export const T=({children})=>children??null;";
inline constexpr std::string_view kSelectedGifModuleStub =
    "const n=()=>null,c=24,v={$$typeof:Symbol.for('react.forward_ref'),"
    "render:n,modalOptions:{}};"
    "export{v as A,c as C,v as E,v as G,v as P,v as S,v as T,v as a,"
    "v as b,n as c,v as d,v as e,n as f,v as g,n as h,n as u};";

// Match only a top-level Vite asset named <stem>-<hash>.js/.mjs. The hash is
// intentionally ignored so Stationhead deployments keep receiving the audited
// contract-compatible stub without broad substring matching.
inline constexpr bool StationheadHashedAssetModulePathMatches(
    std::wstring_view path,
    std::wstring_view stem) {
  constexpr std::wstring_view kAssetsPrefix = L"/assets/";
  if (!path.starts_with(kAssetsPrefix)) return false;
  const std::wstring_view filename = path.substr(kAssetsPrefix.size());
  if (!filename.starts_with(stem)) return false;
  const std::wstring_view suffix = filename.substr(stem.size());
  if (suffix.size() < 11 || suffix.front() != L'-') return false;

  size_t extensionAt = std::wstring_view::npos;
  if (suffix.ends_with(L".mjs")) {
    extensionAt = suffix.size() - 4;
  } else if (suffix.ends_with(L".js")) {
    extensionAt = suffix.size() - 3;
  }
  if (extensionAt == std::wstring_view::npos || extensionAt <= 6) return false;
  for (const wchar_t character : suffix.substr(1, extensionAt - 1)) {
    const bool allowed = (character >= L'a' && character <= L'z') ||
                         (character >= L'0' && character <= L'9') ||
                         character == L'-' || character == L'_';
    if (!allowed) return false;
  }
  return true;
}

// Empty-success responses are safe only for standalone third-party/classic SDKs.
// Same-origin Vite modules require an explicit import/export-compatible stub.
inline constexpr bool StationheadExpandedNonPlaybackScriptBoundaryFixed(
    std::wstring_view uriLower) {
  const StationheadRuntimeUriParts uri = StationheadParseRuntimeUri(uriLower);
  if (!uri.valid || uri.scheme != L"https") return false;
  for (const std::wstring_view domain : kNonPlaybackScriptDomains) {
    if (StationheadRuntimeHostMatches(uri.host, domain)) return true;
  }
  return false;
}

// Return tiny local modules before download. SelectedGIF intentionally removes
// its mixed account/chat/thread/GIF UI exports while preserving their runtime
// shapes: forward-ref-compatible component types, C=24, and no-op hook values.
inline constexpr std::string_view StationheadKnownOptionalModuleStubBoundaryFixed(
    std::wstring_view uriLower) {
  const StationheadRuntimeUriParts uri = StationheadParseRuntimeUri(uriLower);
  if (!uri.valid || uri.scheme != L"https" ||
      !StationheadRuntimeHostMatches(uri.host, L"stationhead.com")) {
    return {};
  }
  if (StationheadHashedAssetModulePathMatches(
          uri.path, L"lottieanimationviewnonlazy")) {
    return kLottieModuleStub;
  }
  if (StationheadHashedAssetModulePathMatches(uri.path, L"tooltip")) {
    return kTooltipModuleStub;
  }
  if (StationheadHashedAssetModulePathMatches(uri.path, L"selectedgif")) {
    return kSelectedGifModuleStub;
  }
  return {};
}

static_assert(StationheadExpandedNonPlaybackScriptBoundaryFixed(
    L"https://cdn.posthog.com/static/array.js"));
static_assert(StationheadExpandedNonPlaybackScriptBoundaryFixed(
    L"https://static.zdassets.com/ekr/snippet.js"));
static_assert(StationheadExpandedNonPlaybackScriptBoundaryFixed(
    L"https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js"));
static_assert(StationheadExpandedNonPlaybackScriptBoundaryFixed(
    L"https://accounts.google.com/gsi/client"));
static_assert(!StationheadExpandedNonPlaybackScriptBoundaryFixed(
    L"https://www.stationhead.com/assets/SelectedGIF-BaAx9j6X.js"));
static_assert(!StationheadExpandedNonPlaybackScriptBoundaryFixed(
    L"https://www.stationhead.com/assets/premium-20-IQ2C1WIZ.js"));
static_assert(!StationheadExpandedNonPlaybackScriptBoundaryFixed(
    L"https://www.stationhead.com/assets/paginationHooks-DAuPuAck.js"));
static_assert(!StationheadExpandedNonPlaybackScriptBoundaryFixed(
    L"https://www.stationhead.com/assets/AppleMusicFreeTrialButton-BzMIl5Mx.js"));
static_assert(StationheadKnownOptionalModuleStubBoundaryFixed(
                  L"https://www.stationhead.com/assets/lottieanimationviewnonlazy-ve60c2no.js") ==
              kLottieModuleStub);
static_assert(StationheadKnownOptionalModuleStubBoundaryFixed(
                  L"https://www.stationhead.com/assets/tooltip-cxafiwy6.js") ==
              kTooltipModuleStub);
static_assert(StationheadKnownOptionalModuleStubBoundaryFixed(
                  L"https://www.stationhead.com/assets/tooltip-different9.js") ==
              kTooltipModuleStub);
static_assert(StationheadKnownOptionalModuleStubBoundaryFixed(
                  L"https://www.stationhead.com/assets/selectedgif-baax9j6x.js") ==
              kSelectedGifModuleStub);
static_assert(StationheadKnownOptionalModuleStubBoundaryFixed(
                  L"https://www.stationhead.com/assets/selectedgif-next1234.mjs") ==
              kSelectedGifModuleStub);
static_assert(StationheadKnownOptionalModuleStubBoundaryFixed(
    L"https://www.stationhead.com/assets/tooltip.js").empty());
static_assert(StationheadKnownOptionalModuleStubBoundaryFixed(
    L"https://www.stationhead.com/assets/player-runtime.js").empty());
static_assert(StationheadKnownOptionalModuleStubBoundaryFixed(
    L"https://stationhead.com.evil.example/assets/selectedgif-baax9j6x.js").empty());
static_assert(StationheadKnownOptionalModuleStubBoundaryFixed(
    L"https://www.stationhead.com/nested/assets/tooltip-cxafiwy6.js").empty());

inline void ApplyStationheadResourceBlockingScriptFixed(
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
              } else {
                block = StationheadRequestIsBlockableBoundaryFixed(lower);
              }
              if (!block && blockImages && StationheadRequestLooksLikeImage(lower)) {
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
            if (block) {
              const bool replacementScript = emptyScript || !moduleStub.empty();
              ComPtr<IStream> responseBody;
              if (!moduleStub.empty()) {
                responseBody.Attach(SHCreateMemStream(
                    reinterpret_cast<const BYTE*>(moduleStub.data()),
                    static_cast<UINT>(moduleStub.size())));
                if (!responseBody) return S_OK;
              }
              ComPtr<ICoreWebView2WebResourceResponse> response;
              const int status = replacementScript ? 200 : (emptyResource ? 204 : 403);
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
#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingScriptFixed
