#pragma once

#include "common.h"

namespace hp {

using WebViewStartupCacheResetCompletion = std::function<void(HRESULT)>;

// Startup cache/data deletion has been removed. Keep this synchronous
// compatibility shim only for older call sites so startup and recovery never
// clear HTTP cache, CacheStorage, Service Workers, cookies, or profile data.
inline void ResetWebViewStartupCaches(
    ICoreWebView2*,
    WebViewStartupCacheResetCompletion completion) noexcept {
  if (!completion) return;
  try {
    completion(S_OK);
  } catch (...) {
  }
}

}  // namespace hp
