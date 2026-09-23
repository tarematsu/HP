#pragma once

#include "audio_health_scan_coordinator.h"

namespace hp {

// Keep every Stationhead profile on a stable periodic-work phase. Profiles are
// created as spotify-v2-1 .. spotify-v2-6; unknown profile names fall back to
// the first slot rather than bypassing serialization.
inline constexpr size_t StationheadPeriodicProfileSlot(
    std::wstring_view profileName) noexcept {
  constexpr std::wstring_view kPrefix = L"spotify-v2-";
  if (profileName.size() != kPrefix.size() + 1 ||
      profileName.substr(0, kPrefix.size()) != kPrefix) {
    return 0;
  }
  const wchar_t suffix = profileName.back();
  if (suffix < L'1' || suffix > L'6') return 0;
  return static_cast<size_t>(suffix - L'1');
}

inline ULONGLONG StationheadProfileAudioHealthScanDelayMs(
    ULONGLONG now, std::wstring_view profileName) noexcept {
  return AudioHealthScanDelayMs(now, StationheadPeriodicProfileSlot(profileName));
}

inline ULONGLONG StationheadProfileAudioHealthRetryMs(
    std::wstring_view profileName) noexcept {
  const ULONGLONG now = GetTickCount64();
  const size_t slot = StationheadPeriodicProfileSlot(profileName);
  if (AudioHealthScanSlotDue(now, slot)) {
    return kAudioHealthScanRetryMs;
  }
  return std::min<ULONGLONG>(
      AudioHealthScanDelayMs(now, slot), kAudioHealthScanSlotSpacingMs);
}

static_assert(StationheadPeriodicProfileSlot(L"spotify-v2-1") == 0);
static_assert(StationheadPeriodicProfileSlot(L"spotify-v2-2") == 1);
static_assert(StationheadPeriodicProfileSlot(L"spotify-v2-3") == 2);
static_assert(StationheadPeriodicProfileSlot(L"spotify-v2-4") == 3);
static_assert(StationheadPeriodicProfileSlot(L"spotify-v2-5") == 4);
static_assert(StationheadPeriodicProfileSlot(L"spotify-v2-6") == 5);
static_assert(StationheadPeriodicProfileSlot(L"Default") == 0);

// The historical filename is retained because the playback statistics contract
// is referenced by the Stationhead startup policy. Runtime request filtering
// no longer lives here; the final Stationhead resource policy is deliberately
// fail-open and cache-preserving.
inline std::wstring StationheadPrimaryPlayStatsScript(int channelId) {
  std::wostringstream script;
  script << LR"JS(
(() => {
  const post = message => {
    try { window.chrome?.webview?.postMessage(message); } catch (_) {}
  };
  const headers = window.__homepanelStationheadAuthHeaders;
  if (!headers?.authorization) {
    post({ type: 'stationhead-play-stats-error', error: 'no-auth-header' });
    return false;
  }
  const lastSuccessAt = Number(window.__homepanelStationheadPlayStatsSuccessAt || 0);
  if (lastSuccessAt > 0 && Date.now() - lastSuccessAt < 10 * 60 * 1000) {
    return false;
  }
  const requestId = Number(window.__homepanelStationheadStatsRequestId || 0) + 1;
  window.__homepanelStationheadStatsRequestId = requestId;
  const url = 'https://production1.stationhead.com/me/channel/)JS"
         << channelId << LR"JS(/streakStats';
  fetch(url, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: Object.assign({ accept: 'application/json' }, headers),
  }).then(async response => {
    if (response.status === 401 || response.status === 403) {
      window.__homepanelStationheadRejectedAuthorization = headers.authorization;
      window.__homepanelStationheadAuthHeaders = null;
      post({
        type: 'stationhead-play-stats-auth-failed',
        status: response.status,
        auth_generation: 1,
      });
      return null;
    }
    if (!response.ok) throw new Error('http-' + response.status);
    return response.json();
  }).then(data => {
    if (data) {
      window.__homepanelStationheadPlayStatsSuccessAt = Date.now();
      post({
        type: 'stationhead-play-stats',
        data,
        source: 'authenticated-api',
        request_id: requestId,
        document_generation: 1,
        auth_generation: 1,
      });
    }
  }).catch(error => {
    post({ type: 'stationhead-play-stats-error', error: String(error?.message || error) });
  });
  return true;
})()
)JS";
  return script.str();
}

}  // namespace hp

#undef StationheadApiPlayStatsScript
#define StationheadApiPlayStatsScript StationheadPrimaryPlayStatsScript

// sh_track_boundary_message_policy.h is parsed later in the native PCH. Route
// its native audio-health scheduling and claim through the profile-derived slot.
// Slots are one minute apart in a six-minute cycle, while the lightweight
// scheduler may still wake once per minute to approach a profile's next slot.
#define AudioHealthScanDelayMs(now, ignoredSlot) \
  StationheadProfileAudioHealthScanDelayMs((now), profileName_)
#define TryClaimAudioHealthScan(now) \
  TryClaimAudioHealthScanSlot( \
      (now), StationheadPeriodicProfileSlot(profileName_))
#define kAudioHealthScanRetryMs \
  StationheadProfileAudioHealthRetryMs(profileName_)
