#pragma once

namespace hp {

inline constexpr bool StationheadRuntimeScriptHostUrl(
    std::wstring_view uriLower) {
  const size_t schemeEnd = uriLower.find(L"://");
  if (schemeEnd == std::wstring_view::npos ||
      uriLower.substr(0, schemeEnd) != L"https") {
    return false;
  }
  const size_t authorityAt = schemeEnd + 3;
  const size_t authorityEnd = uriLower.find_first_of(L"/?#", authorityAt);
  std::wstring_view authority = uriLower.substr(
      authorityAt,
      authorityEnd == std::wstring_view::npos ? std::wstring_view::npos
                                               : authorityEnd - authorityAt);
  if (authority.empty() || authority.find(L'@') != std::wstring_view::npos) {
    return false;
  }
  const size_t portAt = authority.find(L':');
  if (portAt != std::wstring_view::npos) authority = authority.substr(0, portAt);
  return authority == L"stationhead.com" ||
         authority.ends_with(L".stationhead.com");
}

inline constexpr std::wstring_view StationheadRuntimeScriptPath(
    std::wstring_view uriLower) {
  if (!StationheadRuntimeScriptHostUrl(uriLower)) return {};
  const size_t schemeEnd = uriLower.find(L"://");
  const size_t authorityAt = schemeEnd + 3;
  const size_t pathAt = uriLower.find(L'/', authorityAt);
  if (pathAt == std::wstring_view::npos) return {};
  const size_t pathEnd = uriLower.find_first_of(L"?#", pathAt);
  return uriLower.substr(
      pathAt,
      pathEnd == std::wstring_view::npos ? std::wstring_view::npos
                                         : pathEnd - pathAt);
}

// Match only the path of an HTTPS Stationhead request. Searching the complete
// URI could reject an unrelated player script when a CDN hostname itself
// contains a social-feature word.
inline constexpr bool StationheadNonPlaybackScriptUrlRuntimeFixed(
    std::wstring_view uriLower) {
  const std::wstring_view path = StationheadRuntimeScriptPath(uriLower);
  if (path.empty() ||
      (!path.ends_with(L".js") && !path.ends_with(L".mjs"))) {
    return false;
  }

  constexpr std::wstring_view kNonPlaybackScriptNeedles[] = {
      L"chat", L"comment", L"gift", L"tipping", L"trending", L"thread",
      L"reaction", L"emoji", L"listeners", L"audience", L"leaderboard",
      L"onboarding", L"walkthrough", L"tutorial", L"survey", L"feedback",
      L"rating-prompt", L"review-prompt", L"achievement", L"badge-modal",
      L"milestone", L"moderation-panel", L"search-modal", L"explore-panel",
      L"apple-music", L"musickit", L"connect-apple", L"music-service",
      L"service-picker",
  };
  for (const std::wstring_view needle : kNonPlaybackScriptNeedles) {
    if (path.find(needle) != std::wstring_view::npos) return true;
  }
  return false;
}

static_assert(StationheadNonPlaybackScriptUrlRuntimeFixed(
    L"https://www.stationhead.com/assets/chat-panel-a1b2.js"));
static_assert(StationheadNonPlaybackScriptUrlRuntimeFixed(
    L"https://stationhead.com:443/assets/listeners-modal.mjs?build=1"));
static_assert(!StationheadNonPlaybackScriptUrlRuntimeFixed(
    L"https://chat-cdn.stationhead.com/assets/player-runtime-a1b2.js"));
static_assert(!StationheadNonPlaybackScriptUrlRuntimeFixed(
    L"https://cdn.example.com/assets/chat-panel-a1b2.js"));
static_assert(!StationheadNonPlaybackScriptUrlRuntimeFixed(
    L"https://stationhead.com.evil.example/assets/chat-panel-a1b2.js"));

// Final resource policy. Install one WebResourceRequested handler per playback
// WebView and evaluate every blocking rule in that handler. The previous policy
// registered two additional script-only handlers over the same Stationhead
// requests, so allowed scripts still paid for three COM callbacks, duplicate URI
// extraction/lowercasing, and three retained handler objects. Consolidation keeps
// the exact script classifiers, generic telemetry/social blocking, image/font
// policy, and media allow-list while removing that duplicate work.
inline void ApplyStationheadResourceBlockingFinalFixed(
    ICoreWebView2Environment* environment,
    ICoreWebView2* webview,
    const StationheadConfig& config,
    std::atomic<bool>& armed,
    EventRegistrationToken& token) {
  (void)armed;
  if (!environment || !webview) return;
  webview->AddWebResourceRequestedFilter(
      L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE);
  webview->AddWebResourceRequestedFilter(
      L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT);
  webview->AddWebResourceRequestedFilter(
      L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_STYLESHEET);
  webview->AddWebResourceRequestedFilter(
      L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA);
  webview->AddWebResourceRequestedFilter(
      L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT);
  webview->AddWebResourceRequestedFilter(
      L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST);
  webview->AddWebResourceRequestedFilter(
      L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH);
  webview->AddWebResourceRequestedFilter(
      L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_TEXT_TRACK);
  webview->AddWebResourceRequestedFilter(
      L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_EVENT_SOURCE);
  webview->AddWebResourceRequestedFilter(
      L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_WEBSOCKET);
  webview->AddWebResourceRequestedFilter(
      L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MANIFEST);
  webview->AddWebResourceRequestedFilter(
      L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_PING);
  webview->AddWebResourceRequestedFilter(
      L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_CSP_VIOLATION_REPORT);

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
              block = StationheadRequestIsBlockable(lower);
              if (!block && hasContext &&
                  context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT) {
                block =
                    StationheadNonPlaybackScriptUrlRuntimeFixed(lower) ||
                    StationheadAdditionalNonPlaybackScriptUrl(lower);
              }
              if (!block && blockImages &&
                  StationheadRequestLooksLikeImage(lower)) {
                block = true;
              }
              if (!block && hasContext &&
                  context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA) {
                block = !lower.empty() &&
                        !StationheadCorePlaybackRequest(lower);
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
}

}  // namespace hp

#undef ApplyStationheadResourceBlocking
#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingFinalFixed
