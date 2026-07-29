#pragma once

namespace hp {

// The response-validation layer intentionally keeps the last accepted
// Stationhead headers separate from the currently captured headers. A DOM login
// false positive can clear the current slot even though the token was already
// accepted by Stationhead, leaving the periodic streakStats request with
// no-auth-header forever on an otherwise healthy playback page. Use the
// response-validated cache only as a fallback; an explicit 401 still removes it
// through rejectAuthorization(), so expired credentials are not retried.
inline std::wstring StationheadApiPlayStatsScriptAcceptedAuthFallback(
    int channelId) {
  std::wstring script = StationheadApiPlayStatsScript(channelId);
  static constexpr std::wstring_view kCurrentHeadersOnly = LR"JS(  const headers = window.__homepanelStationheadAuthHeaders;
)JS";
  static constexpr std::wstring_view kAcceptedHeadersFallback = LR"JS(  const currentHeaders = window.__homepanelStationheadAuthHeaders;
  const acceptedHeaders = window.__homepanelStationheadLastAcceptedAuthHeaders;
  const headers = currentHeaders?.authorization ? currentHeaders : acceptedHeaders;
)JS";
  const bool replaced = ReplaceStationheadRuntimeFragment(
      script, kCurrentHeadersOnly, kAcceptedHeadersFallback);
  (void)replaced;
  return script;
}

}  // namespace hp

// The wrapper body above expands the previous macro to the runtime-fixed stats
// implementation. Calls compiled after this final PCH layer receive the
// validated-header fallback.
#undef StationheadApiPlayStatsScript
#define StationheadApiPlayStatsScript \
  StationheadApiPlayStatsScriptAcceptedAuthFallback
