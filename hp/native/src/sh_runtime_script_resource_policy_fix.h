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

inline constexpr std::wstring_view kKnownOptionalModuleNeedles[] = {
    L"lottieanimationviewnonlazy",
};

// Empty-success responses are safe only for standalone third-party/classic SDKs.
// Same-origin Vite modules are never emptied here because importers can require
// named exports and fail before the Stationhead player is initialized.
inline constexpr bool StationheadExpandedNonPlaybackScriptBoundaryFixed(
    std::wstring_view uriLower) {
  const StationheadRuntimeUriParts uri = StationheadParseRuntimeUri(uriLower);
  if (!uri.valid || uri.scheme != L"https") return false;
  for (const std::wstring_view domain : kNonPlaybackScriptDomains) {
    if (StationheadRuntimeHostMatches(uri.host, domain)) return true;
  }
  return false;
}

// This exact live-observed module is loaded through React.lazy and exports one
// component. Return a contract-compatible no-op module so the request bytes,
// animation decoder and render work are removed without breaking ESM linking.
inline constexpr std::string_view StationheadKnownOptionalModuleStubBoundaryFixed(
    std::wstring_view uriLower) {
  const StationheadRuntimeUriParts uri = StationheadParseRuntimeUri(uriLower);
  if (!uri.valid || uri.scheme != L"https" ||
      !StationheadRuntimeHostMatches(uri.host, L"stationhead.com") ||
      (!uri.path.ends_with(L".js") && !uri.path.ends_with(L".mjs"))) {
    return {};
  }
  for (const std::wstring_view needle : kKnownOptionalModuleNeedles) {
    if (uri.path.find(needle) != std::wstring_view::npos) {
      return "export const LottieAnimationViewNonLazy=()=>null;";
    }
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
static_assert(!StationheadKnownOptionalModuleStubBoundaryFixed(
    L"https://www.stationhead.com/assets/lottieanimationviewnonlazy-ve60c2no.js").empty());
static_assert(StationheadKnownOptionalModuleStubBoundaryFixed(
    L"https://www.stationhead.com/assets/player-runtime.js").empty());
static_assert(StationheadKnownOptionalModuleStubBoundaryFixed(
    L"https://stationhead.com.evil.example/assets/lottieanimationviewnonlazy.js").empty());

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
                emptyScript =
                    StationheadRequestIsBlockableBoundaryFixed(lower) ||
                    StationheadExpandedNonPlaybackScriptBoundaryFixed(lower);
                block = emptyScript || !moduleStub.empty();
              } else {
                block = StationheadRequestIsBlockableBoundaryFixed(lower);
              }
              if (!block && blockImages && StationheadRequestLooksLikeImage(lower)) {
                block = true;
              }
              if (!block && hasContext &&
                  context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA) {
                block = !lower.empty() &&
                        !StationheadCorePlaybackRequestBoundaryFixed(lower);
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
              const int status = replacementScript ? 200 : 403;
              const wchar_t* reason = replacementScript ? L"OK" : L"Blocked";
              const wchar_t* headers = replacementScript
                  ? L"Content-Type: application/javascript; charset=utf-8\r\n"
                    L"Cache-Control: no-store"
                  : L"";
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
