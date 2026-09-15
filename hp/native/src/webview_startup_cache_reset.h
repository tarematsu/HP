#pragma once

#include "common.h"

namespace hp {

using WebViewStartupCacheResetCompletion = std::function<void(HRESULT)>;

// Drop only transient browser state that can make a restarted media WebView
// reuse stale page/runtime assets. Authentication and durable site data stay
// intact: cookies, localStorage and IndexedDB are deliberately not included.
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

    ComPtr<ICoreWebView2Profile2> profile2;
    result = profile.As(&profile2);
    if (FAILED(result) || !profile2) {
      finish(FAILED(result) ? result : E_NOINTERFACE);
      return;
    }

    constexpr auto kinds = static_cast<COREWEBVIEW2_BROWSING_DATA_KINDS>(
        COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE |
        COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE |
        COREWEBVIEW2_BROWSING_DATA_KINDS_SERVICE_WORKERS);
    auto handler = Callback<ICoreWebView2ClearBrowsingDataCompletedHandler>(
        [finish](HRESULT clearResult) -> HRESULT {
          finish(clearResult);
          return S_OK;
        });
    result = profile2->ClearBrowsingData(kinds, handler.Get());
    if (FAILED(result)) finish(result);
  } catch (...) {
    finish(E_FAIL);
  }
}

}  // namespace hp
