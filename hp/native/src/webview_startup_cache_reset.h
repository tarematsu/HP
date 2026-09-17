#pragma once

#include "common.h"

namespace hp {

using WebViewStartupCacheResetCompletion = std::function<void(HRESULT)>;

namespace webview_profile_recovery {
constexpr ULONGLONG kChurnWindowMs = 5ULL * 60ULL * 1000ULL;
constexpr ULONGLONG kRepairCooldownMs = 30ULL * 60ULL * 1000ULL;
constexpr unsigned kChurnThreshold = 3;

struct State {
  ULONGLONG firstCreationTick = 0;
  ULONGLONG lastRepairTick = 0;
  unsigned creations = 0;
  bool repairInFlight = false;
  std::vector<WebViewStartupCacheResetCompletion> pending;
};

inline std::mutex& Mutex() noexcept {
  static std::mutex mutex;
  return mutex;
}

inline std::map<std::wstring, State>& States() noexcept {
  static std::map<std::wstring, State> states;
  return states;
}

inline void InvokeNoexcept(
    WebViewStartupCacheResetCompletion& completion, HRESULT result) noexcept {
  if (!completion) return;
  try {
    completion(result);
  } catch (...) {
  }
}

inline void CompleteRepair(
    const std::wstring& profileName, HRESULT result) noexcept {
  std::vector<WebViewStartupCacheResetCompletion> pending;
  try {
    std::lock_guard lock(Mutex());
    auto iterator = States().find(profileName);
    if (iterator == States().end()) return;
    iterator->second.repairInFlight = false;
    pending.swap(iterator->second.pending);
  } catch (...) {
    return;
  }
  for (auto& completion : pending) InvokeNoexcept(completion, result);
}
}  // namespace webview_profile_recovery

// Normal startup never deletes profile data. Only repeated controller churn for
// the same named profile escalates to a narrow repair of transient web caches.
// Cookies, localStorage and IndexedDB are deliberately preserved so Spotify and
// Stationhead authentication survives recovery.
inline void ResetWebViewStartupCaches(
    ICoreWebView2* webview,
    WebViewStartupCacheResetCompletion completion) noexcept {
  if (!completion) return;
  if (!webview) {
    webview_profile_recovery::InvokeNoexcept(completion, E_POINTER);
    return;
  }

  try {
    ComPtr<ICoreWebView2_13> profileView;
    ComPtr<ICoreWebView2Profile> profile;
    LPWSTR rawProfileName = nullptr;
    if (FAILED(webview->QueryInterface(IID_PPV_ARGS(&profileView))) ||
        !profileView || FAILED(profileView->get_Profile(&profile)) || !profile ||
        FAILED(profile->get_ProfileName(&rawProfileName)) || !rawProfileName) {
      if (rawProfileName) CoTaskMemFree(rawProfileName);
      webview_profile_recovery::InvokeNoexcept(completion, S_OK);
      return;
    }
    const std::wstring profileName(rawProfileName);
    CoTaskMemFree(rawProfileName);

    const ULONGLONG now = GetTickCount64();
    bool startRepair = false;
    {
      std::lock_guard lock(webview_profile_recovery::Mutex());
      auto& state = webview_profile_recovery::States()[profileName];
      if (state.repairInFlight) {
        state.pending.push_back(std::move(completion));
        return;
      }
      if (state.firstCreationTick == 0 || now < state.firstCreationTick ||
          now - state.firstCreationTick >
              webview_profile_recovery::kChurnWindowMs) {
        state.firstCreationTick = now;
        state.creations = 1;
      } else if (state.creations < UINT_MAX) {
        ++state.creations;
      }

      const bool repairCoolingDown =
          state.lastRepairTick != 0 && now >= state.lastRepairTick &&
          now - state.lastRepairTick <
              webview_profile_recovery::kRepairCooldownMs;
      if (state.creations >= webview_profile_recovery::kChurnThreshold &&
          !repairCoolingDown) {
        state.repairInFlight = true;
        state.lastRepairTick = now;
        state.firstCreationTick = 0;
        state.creations = 0;
        state.pending.push_back(std::move(completion));
        startRepair = true;
      }
    }

    if (!startRepair) {
      webview_profile_recovery::InvokeNoexcept(completion, S_OK);
      return;
    }

    ComPtr<ICoreWebView2Profile2> profile2;
    if (FAILED(profile.As(&profile2)) || !profile2) {
      webview_profile_recovery::CompleteRepair(profileName, E_NOINTERFACE);
      return;
    }
    const auto repairKinds = static_cast<COREWEBVIEW2_BROWSING_DATA_KINDS>(
        COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE |
        COREWEBVIEW2_BROWSING_DATA_KINDS_SERVICE_WORKERS |
        COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE);
    const HRESULT started = profile2->ClearBrowsingData(
        repairKinds,
        Callback<ICoreWebView2ClearBrowsingDataCompletedHandler>(
            [profileName](HRESULT result) -> HRESULT {
              webview_profile_recovery::CompleteRepair(profileName, result);
              return S_OK;
            }).Get());
    if (FAILED(started)) {
      webview_profile_recovery::CompleteRepair(profileName, started);
    }
  } catch (const std::bad_alloc&) {
    webview_profile_recovery::InvokeNoexcept(completion, E_OUTOFMEMORY);
  } catch (...) {
    webview_profile_recovery::InvokeNoexcept(completion, E_FAIL);
  }
}

}  // namespace hp

// sh.cpp includes this compatibility header immediately after the Stationhead
// policy chain. Play-count collection is retired: prevent the old scheduler
// from becoming due and make a legacy direct call harmless.
#undef kStationheadDailyPlayStatsIntervalMs
#define kStationheadDailyPlayStatsIntervalMs 4'000'000'000'000'000'000LL
#undef StationheadApiPlayStatsScript
#define StationheadApiPlayStatsScript(channelId) std::wstring(L"void 0;")
