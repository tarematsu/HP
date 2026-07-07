#pragma once
#include "common.h"
#include "config.h"

namespace hp {
// Shared "50-minute rule": periodic maintenance reload of a long-running
// Stationhead WebView to avoid unbounded session/memory growth. Both the
// primary and secondary players compute this the same way; callers keep
// their own gating conditions (e.g. only reload while audio is playing).
// A non-positive interval means the reload is disabled.
inline int64_t StationheadReloadIntervalMs(int intervalMinutes) noexcept {
  return intervalMinutes > 0 ? static_cast<int64_t>(intervalMinutes) * 60'000 : 0;
}

// Blocks image/font network requests once a Stationhead WebView has
// confirmed playback (armed set true by the caller at that point), matching
// the blockImagesAfterPlayback/blockFontsAfterPlayback config flags' actual
// names (previously loaded from cloud config but never actually applied).
// The filter is registered from webview creation, but the handler only
// blocks once armed is true: the pre-playback "click Start Listening"
// automation depends on getBoundingClientRect() of on-page controls, and
// blocking images before that point can collapse icon-only buttons to zero
// size, breaking auto-play detection and leaving the window stuck visible.
// Shared by both the primary and secondary Stationhead players so the two
// windows apply the same rule the same way. The registered token must be
// removed via webview->remove_WebResourceRequested(token) when the webview
// is closed, and armed should be reset to false at that point too.
inline void ApplyStationheadResourceBlocking(ICoreWebView2Environment* environment,
                                              ICoreWebView2* webview,
                                              const StationheadConfig& config,
                                              std::atomic<bool>& armed,
                                              EventRegistrationToken& token) {
  if (!environment || !webview) return;
  if (!config.blockImagesAfterPlayback && !config.blockFontsAfterPlayback) return;
  if (config.blockImagesAfterPlayback) {
    webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE);
  }
  if (config.blockFontsAfterPlayback) {
    webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT);
  }
  ComPtr<ICoreWebView2Environment> env = environment;
  webview->add_WebResourceRequested(
      Callback<ICoreWebView2WebResourceRequestedEventHandler>(
          [env, &armed](ICoreWebView2*, ICoreWebView2WebResourceRequestedEventArgs* args) -> HRESULT {
            if (!args || !armed.load(std::memory_order_relaxed)) return S_OK;
            ComPtr<ICoreWebView2WebResourceResponse> response;
            if (SUCCEEDED(env->CreateWebResourceResponse(nullptr, 403, L"Blocked", L"", &response))) {
              args->put_Response(response.Get());
            }
            return S_OK;
          }).Get(),
      &token);
}
}  // namespace hp
