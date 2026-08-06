#pragma once
#include <cstdint>
#include <string_view>

namespace hp {

// A single WebView2 audio pulse during initial Stationhead startup must not arm
// fallback. Require continuous audio first; after that, 0 through 10 seconds of
// silence remain a track-transition wait. The operation surface is foregrounded
// at 11 seconds, then gets one second to finish rendering authentication controls
// before native code probes the DOM.
inline constexpr int64_t kStationheadAudioLossArmStabilityMs = 15'000;
inline constexpr int64_t kStationheadAudioLossGraceMs = 11'000;
inline constexpr int64_t kStationheadAudioLossDomSettleMs = 1'000;
inline constexpr int64_t kStationheadFallbackMinimumDwellMs = 15'000;
inline constexpr int64_t kStationheadPrimaryRecoveryStabilityMs = 2'000;

inline constexpr bool StationheadAudioLossCanArm(
    bool audioPlaying,
    bool navigationActive,
    int64_t playingForMs) noexcept {
  return audioPlaying && !navigationActive &&
      playingForMs >= kStationheadAudioLossArmStabilityMs;
}

inline constexpr bool StationheadAudioLossCanProbe(
    bool playbackObserved,
    bool audioPlaying,
    bool created,
    bool navigating,
    bool processFailed,
    bool authenticationPending,
    int64_t stoppedForMs) noexcept {
  return playbackObserved && !audioPlaying && created && !navigating &&
      !processFailed && !authenticationPending &&
      stoppedForMs >=
          kStationheadAudioLossGraceMs + kStationheadAudioLossDomSettleMs;
}

inline constexpr bool StationheadAudioLossCanFallback(
    bool probeComplete,
    bool authenticationUiDetected,
    int64_t stoppedForMs) noexcept {
  return probeComplete && !authenticationUiDetected &&
      stoppedForMs >=
          kStationheadAudioLossGraceMs + kStationheadAudioLossDomSettleMs;
}

inline constexpr bool StationheadFallbackDwellSatisfied(
    int64_t fallbackElapsedMs) noexcept {
  return fallbackElapsedMs >= kStationheadFallbackMinimumDwellMs;
}

inline constexpr std::wstring_view StationheadRoutePath(
    std::wstring_view url) noexcept {
  const size_t suffix = url.find_first_of(L"?#");
  if (suffix != std::wstring_view::npos) url = url.substr(0, suffix);

  const size_t scheme = url.find(L"://");
  if (scheme != std::wstring_view::npos) {
    const size_t path = url.find(L'/', scheme + 3);
    url = path == std::wstring_view::npos
        ? std::wstring_view{L"/"}
        : url.substr(path);
  } else if (url.starts_with(L"//")) {
    const size_t path = url.find(L'/', 2);
    url = path == std::wstring_view::npos
        ? std::wstring_view{L"/"}
        : url.substr(path);
  }

  while (url.size() > 1 && url.back() == L'/') url.remove_suffix(1);
  return url;
}

inline constexpr wchar_t StationheadAsciiLower(wchar_t value) noexcept {
  return value >= L'A' && value <= L'Z' ? value + (L'a' - L'A') : value;
}

inline constexpr bool StationheadFallbackRouteMatches(
    std::wstring_view actual,
    std::wstring_view expected) noexcept {
  actual = StationheadRoutePath(actual);
  expected = StationheadRoutePath(expected);
  if (actual.empty() || expected.empty() || actual.size() != expected.size()) {
    return false;
  }
  for (size_t index = 0; index < actual.size(); ++index) {
    if (StationheadAsciiLower(actual[index]) !=
        StationheadAsciiLower(expected[index])) {
      return false;
    }
  }
  return true;
}

static_assert(!StationheadAudioLossCanArm(true, false, 14'999));
static_assert(StationheadAudioLossCanArm(true, false, 15'000));
static_assert(!StationheadAudioLossCanArm(true, true, 60'000));
static_assert(!StationheadAudioLossCanProbe(
    true, false, true, false, false, false, 11'999));
static_assert(StationheadAudioLossCanProbe(
    true, false, true, false, false, false, 12'000));
static_assert(!StationheadAudioLossCanFallback(true, false, 11'999));
static_assert(StationheadAudioLossCanFallback(true, false, 12'000));
static_assert(!StationheadFallbackDwellSatisfied(14'999));
static_assert(StationheadFallbackDwellSatisfied(15'000));
static_assert(StationheadFallbackRouteMatches(
    L"https://stationhead.com/buddy46/?source=fallback",
    L"https://www.stationhead.com/buddy46"));
static_assert(!StationheadFallbackRouteMatches(
    L"https://www.stationhead.com/sakuramankai",
    L"https://www.stationhead.com/buddy46"));

}  // namespace hp

// sh.h is parsed before this policy header. Rewrite only implementation-time
// accesses to the private managed-fallback latch so every active-state tick also
// verifies the committed WebView route. This repairs failed navigations and
// internal redirects without changing the public StationheadPlayer surface.
#define managedPlaybackFallbackActive_                                      \
  ([&]() -> bool& {                                                         \
    bool& active = managedPlaybackFallbackActive_;                          \
    if (!active || !webview_ || config_.fallbackUrl.empty() ||              \
        recreating_.load(std::memory_order_acquire) ||                      \
        navigationInFlight_.load(std::memory_order_acquire)) {              \
      return active;                                                        \
    }                                                                       \
    const StationheadStatus fallbackRouteStatus = Status();                 \
    if (!fallbackRouteStatus.created || fallbackRouteStatus.navigating ||   \
        fallbackRouteStatus.processFailed ||                               \
        fallbackRouteStatus.spotifyAuthorization ||                        \
        fallbackRouteStatus.loginRequired) {                                \
      return active;                                                        \
    }                                                                       \
    LPWSTR sourceRaw = nullptr;                                             \
    const HRESULT sourceResult = webview_->get_Source(&sourceRaw);          \
    const std::wstring source = sourceRaw ? sourceRaw : L"";               \
    if (sourceRaw) CoTaskMemFree(sourceRaw);                                \
    if (SUCCEEDED(sourceResult) &&                                          \
        !::hp::StationheadFallbackRouteMatches(                             \
            source, config_.fallbackUrl)) {                                 \
      NavigateStationheadUrl(                                               \
          nowMs, config_.fallbackUrl,                                       \
          L"managed fallback active; correcting Stationhead route to fallback URL", \
          true);                                                            \
    }                                                                       \
    return active;                                                          \
  }())
