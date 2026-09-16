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

// Drop only the transient HTTP disk cache once per profile for this app process.
// Keep CacheStorage and Service Workers paired with the profile's persistent
// cookies/localStorage/IndexedDB. Clearing workers while retaining Spotify auth
// state can leave Stationhead apparently authorized but without a coherent
// playback/DRM bootstrap on the first navigation after an app update.
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

    constexpr auto kinds = COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE;
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
