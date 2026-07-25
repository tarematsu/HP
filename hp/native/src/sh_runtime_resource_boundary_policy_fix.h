#pragma once

namespace hp {

struct StationheadRuntimeUriParts {
  bool valid = false;
  std::wstring_view scheme{};
  std::wstring_view host{};
  std::wstring_view path{};
};

inline constexpr StationheadRuntimeUriParts StationheadParseRuntimeUri(
    std::wstring_view uriLower) {
  const size_t schemeEnd = uriLower.find(L"://");
  if (schemeEnd == std::wstring_view::npos || schemeEnd == 0) return {};
  const std::wstring_view scheme = uriLower.substr(0, schemeEnd);
  if (scheme != L"https" && scheme != L"http") return {};

  const size_t authorityAt = schemeEnd + 3;
  const size_t authorityEnd = uriLower.find_first_of(L"/?#", authorityAt);
  std::wstring_view authority = uriLower.substr(
      authorityAt,
      authorityEnd == std::wstring_view::npos ? std::wstring_view::npos
                                               : authorityEnd - authorityAt);
  if (authority.empty() || authority.find(L'@') != std::wstring_view::npos ||
      authority.front() == L'[') {
    return {};
  }

  const size_t portAt = authority.find(L':');
  if (portAt != std::wstring_view::npos) {
    if (portAt == 0 || portAt + 1 >= authority.size()) return {};
    for (const wchar_t digit : authority.substr(portAt + 1)) {
      if (digit < L'0' || digit > L'9') return {};
    }
    authority = authority.substr(0, portAt);
  }
  if (authority.empty()) return {};

  std::wstring_view path{};
  if (authorityEnd != std::wstring_view::npos && uriLower[authorityEnd] == L'/') {
    const size_t pathEnd = uriLower.find_first_of(L"?#", authorityEnd);
    path = uriLower.substr(
        authorityEnd,
        pathEnd == std::wstring_view::npos ? std::wstring_view::npos
                                           : pathEnd - authorityEnd);
  }
  return {true, scheme, authority, path};
}

inline constexpr bool StationheadRuntimeHostMatches(
    std::wstring_view host,
    std::wstring_view domain) {
  if (host == domain) return true;
  return host.size() > domain.size() && host.ends_with(domain) &&
         host[host.size() - domain.size() - 1] == L'.';
}

inline constexpr bool StationheadTelemetryRequestBoundaryFixed(
    std::wstring_view uriLower) {
  const StationheadRuntimeUriParts uri = StationheadParseRuntimeUri(uriLower);
  if (!uri.valid) return false;

  constexpr std::wstring_view kTelemetryDomains[] = {
      L"firebaseinstallations.googleapis.com",
      L"firebaseremoteconfig.googleapis.com",
      L"firebase.googleapis.com",
      L"firebaselogging.googleapis.com",
      L"firestore.googleapis.com",
      L"firebasecrashlytics.googleapis.com",
      L"crashlyticsreports-pa.googleapis.com",
      L"crashlytics.com",
      L"amplitude.com",
      L"google-analytics.com",
      L"analytics.google.com",
      L"googletagmanager.com",
      L"doubleclick.net",
      L"sentry.io",
      L"bugsnag.com",
      L"branch.io",
      L"segment.io",
      L"segment.com",
      L"mixpanel.com",
      L"hotjar.com",
      L"fullstory.com",
      L"appsflyer.com",
      L"adjust.com",
      L"braze.com",
      L"onesignal.com",
      L"intercom.io",
      L"clarity.ms",
      L"datadoghq.com",
      L"datadoghq.eu",
      L"newrelic.com",
      L"nr-data.net",
      L"statsigapi.net",
      L"launchdarkly.com",
      L"googleadservices.com",
      L"adservice.google.com",
      L"tiktok.com",
      L"snapchat.com",
      L"pinterest.com",
  };
  for (const std::wstring_view domain : kTelemetryDomains) {
    if (StationheadRuntimeHostMatches(uri.host, domain)) return true;
  }

  if (StationheadRuntimeHostMatches(uri.host, L"connect.facebook.net")) {
    return true;
  }
  if (StationheadRuntimeHostMatches(uri.host, L"facebook.com") &&
      uri.path.starts_with(L"/tr")) {
    return true;
  }
  if ((StationheadRuntimeHostMatches(uri.host, L"twitter.com") ||
       StationheadRuntimeHostMatches(uri.host, L"x.com")) &&
      uri.path.starts_with(L"/i/")) {
    return true;
  }
  return false;
}

inline constexpr bool StationheadSocialApiRequestBoundaryFixed(
    std::wstring_view uriLower) {
  const StationheadRuntimeUriParts uri = StationheadParseRuntimeUri(uriLower);
  if (!uri.valid || uri.scheme != L"https" ||
      uri.host != L"production1.stationhead.com") {
    return false;
  }

  constexpr std::wstring_view kSocialPaths[] = {
      L"/chathistory",
      L"/tippingstatus",
      L"/posts/trending",
      L"/threads/",
      L"/tipping",
      L"/emoji",
      L"/gifts",
  };
  for (const std::wstring_view needle : kSocialPaths) {
    if (uri.path.find(needle) != std::wstring_view::npos) return true;
  }
  if (uri.path == L"/plus/status") return true;

  constexpr std::wstring_view kStationPrefix = L"/station/";
  constexpr std::wstring_view kListenerSuffix = L"/listener";
  if (uri.path.starts_with(kStationPrefix)) {
    const std::wstring_view stationPath = uri.path.substr(kStationPrefix.size());
    const size_t separator = stationPath.find(L'/');
    if (separator > 0 && stationPath.substr(separator) == kListenerSuffix) {
      return true;
    }
  }
  return false;
}

inline constexpr bool StationheadRequestIsBlockableBoundaryFixed(
    std::wstring_view uriLower) {
  return StationheadTelemetryRequestBoundaryFixed(uriLower) ||
         StationheadSocialApiRequestBoundaryFixed(uriLower);
}

inline constexpr bool StationheadCorePlaybackRequestBoundaryFixed(
    std::wstring_view uriLower) {
  const StationheadRuntimeUriParts uri = StationheadParseRuntimeUri(uriLower);
  if (!uri.valid || uri.scheme != L"https") return false;

  if (uri.host == L"realtime-production.stationhead.com" &&
      uri.path.starts_with(L"/app/")) {
    return true;
  }
  if (StationheadRuntimeHostMatches(uri.host, L"scdn.co")) return true;

  if (StationheadRuntimeHostMatches(uri.host, L"stationhead.com")) {
    return uri.path.find(L"/timestamp") != std::wstring_view::npos ||
           uri.path.find(L"/pusher/presenceauth") != std::wstring_view::npos ||
           uri.path.find(L"/channels/alias/") != std::wstring_view::npos ||
           uri.path.find(L"/me/country") != std::wstring_view::npos;
  }

  if (uri.host.find(L"spotify") != std::wstring_view::npos) {
    return uriLower.find(L"audio") != std::wstring_view::npos ||
           uriLower.find(L"playback") != std::wstring_view::npos ||
           uriLower.find(L"gew") != std::wstring_view::npos;
  }
  return false;
}

static_assert(StationheadRequestIsBlockableBoundaryFixed(
    L"https://api2.amplitude.com/2/httpapi"));
static_assert(StationheadRequestIsBlockableBoundaryFixed(
    L"https://production1.stationhead.com/chathistory"));
static_assert(!StationheadRequestIsBlockableBoundaryFixed(
    L"https://production1.stationhead.com/timestamp?next=https://sentry.io"));
static_assert(!StationheadRequestIsBlockableBoundaryFixed(
    L"https://p.scdn.co/audio/chathistory-track.mp3"));
static_assert(!StationheadRequestIsBlockableBoundaryFixed(
    L"https://production1.stationhead.com.evil.example/chathistory"));
static_assert(StationheadCorePlaybackRequestBoundaryFixed(
    L"https://realtime-production.stationhead.com/app/key"));
static_assert(StationheadCorePlaybackRequestBoundaryFixed(
    L"https://p.scdn.co/track/file"));
static_assert(!StationheadCorePlaybackRequestBoundaryFixed(
    L"https://stationhead.com.evil.example/timestamp"));

// CDP URL blocking has no resource-context filter. Keep it only for anchored
// telemetry destinations; image/font decisions belong to WebResourceRequested,
// where a signed audio URL containing an artwork suffix cannot be rejected.
inline void BlockStationheadTelemetrySocketsBoundaryFixed(
    ICoreWebView2* webview) {
  if (!webview) return;
  webview->CallDevToolsProtocolMethod(L"Network.enable", L"{}", nullptr);

  std::wstring blockedUrls = L"{\"urls\":[";
  bool first = true;
  const auto appendDomain = [&](std::wstring_view domain) {
    if (!first) blockedUrls += L',';
    first = false;
    blockedUrls += L"\"*://";
    blockedUrls.append(domain);
    blockedUrls += L"/*\",\"*://*.";
    blockedUrls.append(domain);
    blockedUrls += L"/*\"";
  };
  constexpr std::wstring_view kSocketDomains[] = {
      L"amplitude.com",
      L"google-analytics.com",
      L"googletagmanager.com",
      L"doubleclick.net",
      L"sentry.io",
      L"bugsnag.com",
      L"segment.io",
      L"segment.com",
      L"mixpanel.com",
      L"clarity.ms",
      L"datadoghq.com",
      L"datadoghq.eu",
      L"newrelic.com",
      L"nr-data.net",
      L"statsigapi.net",
      L"launchdarkly.com",
  };
  for (const std::wstring_view domain : kSocketDomains) appendDomain(domain);
  blockedUrls += L"]}";
  webview->CallDevToolsProtocolMethod(
      L"Network.setBlockedURLs", blockedUrls.c_str(), nullptr);
}

// Last resource boundary. The earlier policy is intentionally not called: once
// an event handler supplies a blocking response, a later handler cannot safely
// reconstruct the original network request. Register one final handler using
// strict destination-host and Stationhead-API path classification.
inline void ApplyStationheadResourceBlockingBoundaryFixed(
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
              block = StationheadRequestIsBlockableBoundaryFixed(lower);
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
  ApplyStationheadNonPlaybackScriptBlockingRuntimeFixed(environment, webview);
  ApplyStationheadAdditionalScriptBlockingRuntimeFixed(environment, webview);
}

}  // namespace hp

#undef ApplyStationheadResourceBlocking
#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingBoundaryFixed
