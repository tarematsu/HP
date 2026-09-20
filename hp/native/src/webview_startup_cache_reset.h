#pragma once

#include "common.h"

namespace hp {

using WebViewStartupCacheResetCompletion = std::function<void(HRESULT)>;

namespace detail {

constexpr wchar_t kTgutStationheadProfileName[] = L"spotify-v2-1";
constexpr wchar_t kTgutLoginResetMarker[] = L".homepanel-tgut-login-reset-v1.done";

inline void CompleteWebViewStartupReset(
    const WebViewStartupCacheResetCompletion& completion,
    HRESULT result) noexcept {
  if (!completion) return;
  try {
    completion(result);
  } catch (...) {
  }
}

}  // namespace detail

// Keep normal startup cache/data deletion disabled. The former amazon slot is
// now the tgut Stationhead window but deliberately keeps the same
// spotify-v2-1 profile folder. Clear only login-bearing profile data once, then
// leave a marker inside that same profile directory so the new tgut login is
// preserved on every later startup.
inline void ResetWebViewStartupCaches(
    ICoreWebView2* webview,
    WebViewStartupCacheResetCompletion completion) noexcept {
  if (!completion) return;
  if (!webview) {
    detail::CompleteWebViewStartupReset(completion, E_INVALIDARG);
    return;
  }

  try {
    ComPtr<ICoreWebView2> base = webview;
    ComPtr<ICoreWebView2_13> profileView;
    HRESULT result = base.As(&profileView);
    if (FAILED(result) || !profileView) {
      detail::CompleteWebViewStartupReset(
          completion, FAILED(result) ? result : E_NOINTERFACE);
      return;
    }

    ComPtr<ICoreWebView2Profile> profile;
    result = profileView->get_Profile(&profile);
    if (FAILED(result) || !profile) {
      detail::CompleteWebViewStartupReset(
          completion, FAILED(result) ? result : E_NOINTERFACE);
      return;
    }

    LPWSTR profileNameRaw = nullptr;
    result = profile->get_ProfileName(&profileNameRaw);
    if (FAILED(result)) {
      detail::CompleteWebViewStartupReset(completion, result);
      return;
    }
    const std::wstring profileName = profileNameRaw ? profileNameRaw : L"";
    CoTaskMemFree(profileNameRaw);
    if (_wcsicmp(profileName.c_str(), detail::kTgutStationheadProfileName) != 0) {
      detail::CompleteWebViewStartupReset(completion, S_OK);
      return;
    }

    LPWSTR profilePathRaw = nullptr;
    result = profile->get_ProfilePath(&profilePathRaw);
    if (FAILED(result) || !profilePathRaw || !*profilePathRaw) {
      CoTaskMemFree(profilePathRaw);
      detail::CompleteWebViewStartupReset(
          completion, FAILED(result) ? result : E_FAIL);
      return;
    }
    const fs::path profilePath(profilePathRaw);
    CoTaskMemFree(profilePathRaw);
    const fs::path markerPath = profilePath / detail::kTgutLoginResetMarker;

    std::error_code markerError;
    if (fs::exists(markerPath, markerError) && !markerError) {
      detail::CompleteWebViewStartupReset(completion, S_OK);
      return;
    }

    ComPtr<ICoreWebView2Profile2> profile2;
    result = profile.As(&profile2);
    if (FAILED(result) || !profile2) {
      detail::CompleteWebViewStartupReset(
          completion, FAILED(result) ? result : E_NOINTERFACE);
      return;
    }

    const auto loginDataKinds = static_cast<COREWEBVIEW2_BROWSING_DATA_KINDS>(
        static_cast<uint32_t>(COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES) |
        static_cast<uint32_t>(COREWEBVIEW2_BROWSING_DATA_KINDS_ALL_DOM_STORAGE) |
        static_cast<uint32_t>(COREWEBVIEW2_BROWSING_DATA_KINDS_PASSWORD_AUTOSAVE) |
        static_cast<uint32_t>(COREWEBVIEW2_BROWSING_DATA_KINDS_GENERAL_AUTOFILL));

    const HRESULT clearStarted = profile2->ClearBrowsingData(
        loginDataKinds,
        Callback<ICoreWebView2ClearBrowsingDataCompletedHandler>(
            [markerPath, completion](HRESULT clearResult) -> HRESULT {
              if (FAILED(clearResult)) {
                detail::CompleteWebViewStartupReset(completion, clearResult);
                return S_OK;
              }
              try {
                std::ofstream marker(
                    markerPath, std::ios::binary | std::ios::trunc);
                if (!marker) {
                  detail::CompleteWebViewStartupReset(
                      completion, HRESULT_FROM_WIN32(ERROR_WRITE_FAULT));
                  return S_OK;
                }
                marker << "tgut-login-reset-v1\n";
                marker.close();
                if (!marker) {
                  detail::CompleteWebViewStartupReset(
                      completion, HRESULT_FROM_WIN32(ERROR_WRITE_FAULT));
                  return S_OK;
                }
                detail::CompleteWebViewStartupReset(completion, S_OK);
              } catch (...) {
                detail::CompleteWebViewStartupReset(completion, E_FAIL);
              }
              return S_OK;
            }).Get());
    if (FAILED(clearStarted)) {
      detail::CompleteWebViewStartupReset(completion, clearStarted);
    }
  } catch (...) {
    detail::CompleteWebViewStartupReset(completion, E_FAIL);
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
