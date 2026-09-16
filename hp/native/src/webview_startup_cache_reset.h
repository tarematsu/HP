#pragma once

#include "common.h"

namespace hp {

using WebViewStartupCacheResetCompletion = std::function<void(HRESULT)>;

inline std::mutex& WebViewStartupCacheResetMutex() noexcept {
  static std::mutex mutex;
  return mutex;
}

inline std::map<std::wstring, bool>& WebViewStartupCacheResetProfiles() noexcept {
  static std::map<std::wstring, bool> profiles;
  return profiles;
}

inline bool ClaimWebViewStartupCacheReset(const std::wstring& profilePath) {
  std::lock_guard lock(WebViewStartupCacheResetMutex());
  return WebViewStartupCacheResetProfiles().try_emplace(profilePath, true).second;
}

inline void ReleaseWebViewStartupCacheResetClaim(
    const std::wstring& profilePath) noexcept {
  try {
    std::lock_guard lock(WebViewStartupCacheResetMutex());
    WebViewStartupCacheResetProfiles().erase(profilePath);
  } catch (...) {
  }
}

inline bool IsStationheadStartupCacheProfile(
    ICoreWebView2Profile* profile, const std::wstring& profilePath) noexcept {
  if (profile) {
    LPWSTR rawProfileName = nullptr;
    if (SUCCEEDED(profile->get_ProfileName(&rawProfileName)) && rawProfileName) {
      const bool stationheadProfile =
          _wcsicmp(rawProfileName, L"spotify-v2-1") == 0;
      CoTaskMemFree(rawProfileName);
      return stationheadProfile;
    }
    if (rawProfileName) CoTaskMemFree(rawProfileName);
  }
  try {
    return _wcsicmp(fs::path(profilePath).filename().c_str(), L"spotify-v2-1") == 0;
  } catch (...) {
    return false;
  }
}

// Reset transient browser state only for Stationhead. Stationhead reuses the
// `spotify-v2-1` profile; clear HTTP disk cache, CacheStorage, Service Workers
// and IndexedDB once per app process. Cookies and localStorage remain
// persistent. All other WebView profiles, including Spotify windows, are left
// untouched.
inline void ResetWebViewStartupCaches(
    ICoreWebView2* webview,
    WebViewStartupCacheResetCompletion completion) noexcept {
  auto sharedCompletion =
      std::make_shared<WebViewStartupCacheResetCompletion>(std::move(completion));
  const auto finish = [sharedCompletion](HRESULT result) noexcept {
    if (!sharedCompletion || !*sharedCompletion) return;
    auto callback = std::move(*sharedCompletion);
    *sharedCompletion = {};
    try {
      callback(result);
    } catch (...) {
    }
  };

  if (!webview) {
    finish(E_POINTER);
    return;
  }

  try {
    ComPtr<ICoreWebView2_13> webview13;
    HRESULT result = webview->QueryInterface(IID_PPV_ARGS(&webview13));
    if (FAILED(result) || !webview13) {
      finish(FAILED(result) ? result : E_NOINTERFACE);
      return;
    }

    ComPtr<ICoreWebView2Profile> profile;
    result = webview13->get_Profile(&profile);
    if (FAILED(result) || !profile) {
      finish(FAILED(result) ? result : E_NOINTERFACE);
      return;
    }

    LPWSTR rawProfilePath = nullptr;
    result = profile->get_ProfilePath(&rawProfilePath);
    if (FAILED(result) || !rawProfilePath || !*rawProfilePath) {
      if (rawProfilePath) CoTaskMemFree(rawProfilePath);
      finish(FAILED(result) ? result : E_FAIL);
      return;
    }
    const std::wstring profilePath(rawProfilePath);
    CoTaskMemFree(rawProfilePath);

    if (!IsStationheadStartupCacheProfile(profile.Get(), profilePath)) {
      finish(S_FALSE);
      return;
    }

    if (!ClaimWebViewStartupCacheReset(profilePath)) {
      finish(S_FALSE);
      return;
    }

    ComPtr<ICoreWebView2Profile2> profile2;
    result = profile.As(&profile2);
    if (FAILED(result) || !profile2) {
      ReleaseWebViewStartupCacheResetClaim(profilePath);
      finish(FAILED(result) ? result : E_NOINTERFACE);
      return;
    }

    const auto kinds = static_cast<COREWEBVIEW2_BROWSING_DATA_KINDS>(
        COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE |
        COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE |
        COREWEBVIEW2_BROWSING_DATA_KINDS_SERVICE_WORKERS |
        COREWEBVIEW2_BROWSING_DATA_KINDS_INDEXED_DB);
    auto handler = Callback<ICoreWebView2ClearBrowsingDataCompletedHandler>(
        [finish, profilePath](HRESULT clearResult) -> HRESULT {
          if (FAILED(clearResult)) {
            ReleaseWebViewStartupCacheResetClaim(profilePath);
          }
          finish(clearResult);
          return S_OK;
        });
    result = profile2->ClearBrowsingData(kinds, handler.Get());
    if (FAILED(result)) {
      ReleaseWebViewStartupCacheResetClaim(profilePath);
      finish(result);
    }
  } catch (...) {
    finish(E_FAIL);
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
