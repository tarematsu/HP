#pragma once

#include "common.h"

namespace hp {

using PlaybackResourceModeGeneration =
    std::shared_ptr<std::atomic<uint64_t>>;

inline uint64_t BeginPlaybackResourceModeChange(
    const PlaybackResourceModeGeneration& generation) noexcept {
  if (!generation) return 0;
  return generation->fetch_add(1, std::memory_order_acq_rel) + 1;
}

inline bool PlaybackResourceModeChangeIsCurrent(
    const PlaybackResourceModeGeneration& generation,
    uint64_t expectedGeneration) noexcept {
  return !generation ||
      generation->load(std::memory_order_acquire) == expectedGeneration;
}

inline bool SetWebViewPlaybackMemoryTarget(
    ICoreWebView2* webview, bool constrained) noexcept {
  if (!webview) return false;

  ComPtr<ICoreWebView2_19> webview19;
  if (FAILED(webview->QueryInterface(IID_PPV_ARGS(&webview19))) || !webview19) {
    return false;
  }

  return SUCCEEDED(webview19->put_MemoryUsageTargetLevel(
      constrained ? COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                  : COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL));
}

inline void SetWindowsProcessEfficiencyMode(
    INT32 processId, bool enabled) noexcept {
  if (processId <= 0 || static_cast<DWORD>(processId) == GetCurrentProcessId()) {
    return;
  }

  HANDLE process = OpenProcess(PROCESS_SET_INFORMATION, FALSE,
                               static_cast<DWORD>(processId));
  if (!process) return;

  // Keep the playback renderer responsive enough for DRM/audio callbacks while
  // still opting it into EcoQoS. This is intentionally less aggressive than
  // IDLE_PRIORITY_CLASS, which previously delayed Spotify renderer work.
  SetPriorityClass(process,
                   enabled ? BELOW_NORMAL_PRIORITY_CLASS
                           : NORMAL_PRIORITY_CLASS);

  PROCESS_POWER_THROTTLING_STATE throttling{};
  throttling.Version = PROCESS_POWER_THROTTLING_CURRENT_VERSION;
  throttling.ControlMask = PROCESS_POWER_THROTTLING_EXECUTION_SPEED;
  throttling.StateMask = enabled
      ? PROCESS_POWER_THROTTLING_EXECUTION_SPEED
      : 0;
  SetProcessInformation(process, ProcessPowerThrottling, &throttling,
                        sizeof(throttling));
  CloseHandle(process);
}

inline bool FrameInfoCollectionContainsFrame(
    ICoreWebView2FrameInfoCollection* frames, UINT32 frameId) noexcept {
  if (!frames || frameId == 0) return false;

  ComPtr<ICoreWebView2FrameInfoCollectionIterator> iterator;
  if (FAILED(frames->GetIterator(&iterator)) || !iterator) return false;

  BOOL hasCurrent = FALSE;
  while (SUCCEEDED(iterator->get_HasCurrent(&hasCurrent)) && hasCurrent) {
    ComPtr<ICoreWebView2FrameInfo> frameInfo;
    if (SUCCEEDED(iterator->GetCurrent(&frameInfo)) && frameInfo) {
      ComPtr<ICoreWebView2FrameInfo2> frameInfo2;
      if (SUCCEEDED(frameInfo.As(&frameInfo2)) && frameInfo2) {
        UINT32 candidateFrameId = 0;
        if (SUCCEEDED(frameInfo2->get_FrameId(&candidateFrameId)) &&
            candidateFrameId == frameId) {
          return true;
        }
      }
    }

    BOOL hasNext = FALSE;
    if (FAILED(iterator->MoveNext(&hasNext))) break;
  }
  return false;
}

// WebView2 environments are shared by YouTube, TVer, Spotify and Stationhead.
// Never throttle the whole environment. Match the WebView main-frame ID to the
// renderer process snapshot and change only that renderer's Windows policy.
// GetProcessExtendedInfos is asynchronous, so a generation token prevents an
// older LOW request from racing past a newer NORMAL recovery request.
inline bool SetWebViewRendererEfficiencyMode(
    ICoreWebView2Environment* environment,
    ICoreWebView2* webview,
    bool enabled,
    PlaybackResourceModeGeneration generation = nullptr,
    uint64_t expectedGeneration = 0) noexcept {
  if (!environment || !webview) return false;

  ComPtr<ICoreWebView2_20> webview20;
  if (FAILED(webview->QueryInterface(IID_PPV_ARGS(&webview20))) || !webview20) {
    return false;
  }
  UINT32 frameId = 0;
  if (FAILED(webview20->get_FrameId(&frameId)) || frameId == 0) return false;

  ComPtr<ICoreWebView2Environment13> environment13;
  if (FAILED(environment->QueryInterface(IID_PPV_ARGS(&environment13))) ||
      !environment13) {
    return false;
  }

  const HRESULT started = environment13->GetProcessExtendedInfos(
      Callback<ICoreWebView2GetProcessExtendedInfosCompletedHandler>(
          [frameId, enabled, generation = std::move(generation),
           expectedGeneration](
              HRESULT result,
              ICoreWebView2ProcessExtendedInfoCollection* collection)
              -> HRESULT {
            if (FAILED(result) || !collection ||
                !PlaybackResourceModeChangeIsCurrent(
                    generation, expectedGeneration)) {
              return S_OK;
            }

            UINT32 count = 0;
            if (FAILED(collection->get_Count(&count))) return S_OK;
            for (UINT32 index = 0; index < count; ++index) {
              ComPtr<ICoreWebView2ProcessExtendedInfo> extendedInfo;
              if (FAILED(collection->GetValueAtIndex(index, &extendedInfo)) ||
                  !extendedInfo) {
                continue;
              }

              ComPtr<ICoreWebView2ProcessInfo> processInfo;
              if (FAILED(extendedInfo->get_ProcessInfo(&processInfo)) ||
                  !processInfo) {
                continue;
              }
              COREWEBVIEW2_PROCESS_KIND kind =
                  COREWEBVIEW2_PROCESS_KIND_BROWSER;
              if (FAILED(processInfo->get_Kind(&kind)) ||
                  kind != COREWEBVIEW2_PROCESS_KIND_RENDERER) {
                continue;
              }

              ComPtr<ICoreWebView2FrameInfoCollection> frames;
              if (FAILED(extendedInfo->get_AssociatedFrameInfos(&frames)) ||
                  !FrameInfoCollectionContainsFrame(frames.Get(), frameId)) {
                continue;
              }

              if (!PlaybackResourceModeChangeIsCurrent(
                      generation, expectedGeneration)) {
                return S_OK;
              }
              INT32 processId = 0;
              if (SUCCEEDED(processInfo->get_ProcessId(&processId))) {
                SetWindowsProcessEfficiencyMode(processId, enabled);
              }
              break;
            }
            return S_OK;
          }).Get());
  return SUCCEEDED(started);
}

}  // namespace hp
