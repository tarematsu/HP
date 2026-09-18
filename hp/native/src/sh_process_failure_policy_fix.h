#pragma once

#include "common.h"

namespace hp {
namespace stationhead_process_failure_policy {

inline constexpr ULONGLONG kRendererUnresponsiveConfirmWindowMs =
    15ULL * 1000ULL;
inline std::atomic<ULONGLONG> rendererUnresponsiveFirstTick{0};
inline std::atomic<unsigned> rendererUnresponsiveCount{0};

inline bool ShouldForwardStationheadProcessFailure(
    ICoreWebView2ProcessFailedEventArgs* args) noexcept {
  if (!args) return false;
  COREWEBVIEW2_PROCESS_FAILED_KIND kind{};
  if (FAILED(args->get_ProcessFailedKind(&kind))) return false;

  if (kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED ||
      kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED) {
    rendererUnresponsiveFirstTick.store(0, std::memory_order_release);
    rendererUnresponsiveCount.store(0, std::memory_order_release);
    return true;
  }

  if (kind != COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE) {
    // GPU, frame-only, utility, sandbox-helper and other transient child
    // failures are normally recovered by WebView2 itself. Stationhead's native
    // audio health path will still detect a real playback loss, so these events
    // must not independently trigger a WebView recreation.
    return false;
  }

  const ULONGLONG now = GetTickCount64();
  const ULONGLONG first =
      rendererUnresponsiveFirstTick.load(std::memory_order_acquire);
  if (first == 0 || now < first ||
      now - first > kRendererUnresponsiveConfirmWindowMs) {
    rendererUnresponsiveFirstTick.store(now, std::memory_order_release);
    rendererUnresponsiveCount.store(1, std::memory_order_release);
    return false;
  }

  const unsigned count =
      rendererUnresponsiveCount.fetch_add(1, std::memory_order_acq_rel) + 1;
  if (count < 2) return false;

  rendererUnresponsiveFirstTick.store(0, std::memory_order_release);
  rendererUnresponsiveCount.store(0, std::memory_order_release);
  return true;
}

inline ComPtr<ICoreWebView2ProcessFailedEventHandler>
WrapStationheadClassifiedProcessFailedHandler(
    ICoreWebView2ProcessFailedEventHandler* handler) noexcept {
  if (!handler) return {};
  // Preserve the base exception-containment wrapper, then add classification in
  // front of it so only failures that invalidate the playback surface reach the
  // existing ScheduleRecreate path.
  ComPtr<ICoreWebView2ProcessFailedEventHandler> inner =
      ::hp::stationhead_webview_policy::
          WrapStationheadProcessFailedHandler(handler);
  return Callback<ICoreWebView2ProcessFailedEventHandler>(
      [inner = std::move(inner)](
          ICoreWebView2* sender,
          ICoreWebView2ProcessFailedEventArgs* args) noexcept -> HRESULT {
        if (!inner || !sender || !args) return S_OK;
        if (!ShouldForwardStationheadProcessFailure(args)) return S_OK;
        return inner->Invoke(sender, args);
      });
}

static_assert(kRendererUnresponsiveConfirmWindowMs == 15ULL * 1000ULL);

}  // namespace stationhead_process_failure_policy
}  // namespace hp

#ifdef add_ProcessFailed
#undef add_ProcessFailed
#endif
#define add_ProcessFailed(handler, token)                                     \
  add_ProcessFailed(                                                          \
      ::hp::stationhead_process_failure_policy::                              \
          WrapStationheadClassifiedProcessFailedHandler((handler)).Get(),     \
      (token))
