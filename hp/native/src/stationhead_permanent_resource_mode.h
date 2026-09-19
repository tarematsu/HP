#pragma once

#include "common.h"

namespace hp {
namespace stationhead_resource_mode_detail {

inline void SetProcessEfficiencyMode(INT32 processId) noexcept {
  if (processId <= 0 || static_cast<DWORD>(processId) == GetCurrentProcessId()) {
    return;
  }

  HANDLE process = OpenProcess(PROCESS_SET_INFORMATION, FALSE,
                               static_cast<DWORD>(processId));
  if (!process) return;

  SetPriorityClass(process, BELOW_NORMAL_PRIORITY_CLASS);

  PROCESS_POWER_THROTTLING_STATE throttling{};
  throttling.Version = PROCESS_POWER_THROTTLING_CURRENT_VERSION;
  throttling.ControlMask = PROCESS_POWER_THROTTLING_EXECUTION_SPEED;
  throttling.StateMask = PROCESS_POWER_THROTTLING_EXECUTION_SPEED;
  SetProcessInformation(process, ProcessPowerThrottling, &throttling,
                        sizeof(throttling));
  CloseHandle(process);
}

inline bool FrameCollectionContains(
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

inline void SetRendererEfficiencyMode(
    ICoreWebView2Environment* environment,
    ICoreWebView2* webview) noexcept {
  if (!environment || !webview) return;

  ComPtr<ICoreWebView2_20> webview20;
  if (FAILED(webview->QueryInterface(IID_PPV_ARGS(&webview20))) || !webview20) {
    return;
  }

  UINT32 frameId = 0;
  if (FAILED(webview20->get_FrameId(&frameId)) || frameId == 0) return;

  ComPtr<ICoreWebView2Environment13> environment13;
  if (FAILED(environment->QueryInterface(IID_PPV_ARGS(&environment13))) ||
      !environment13) {
    return;
  }

  environment13->GetProcessExtendedInfos(
      Callback<ICoreWebView2GetProcessExtendedInfosCompletedHandler>(
          [frameId](HRESULT result,
                    ICoreWebView2ProcessExtendedInfoCollection* collection)
              -> HRESULT {
            if (FAILED(result) || !collection) return S_OK;

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
                  !FrameCollectionContains(frames.Get(), frameId)) {
                continue;
              }

              INT32 processId = 0;
              if (SUCCEEDED(processInfo->get_ProcessId(&processId))) {
                SetProcessEfficiencyMode(processId);
              }
              break;
            }
            return S_OK;
          }).Get());
}

}  // namespace stationhead_resource_mode_detail

inline void ApplyStationheadPermanentWebViewResourceMode(
    ICoreWebView2Environment* environment,
    ICoreWebView2* webview) noexcept {
  if (!webview) return;

  ComPtr<ICoreWebView2_19> webview19;
  if (SUCCEEDED(webview->QueryInterface(IID_PPV_ARGS(&webview19))) &&
      webview19) {
    webview19->put_MemoryUsageTargetLevel(
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW);
  }

  stationhead_resource_mode_detail::SetRendererEfficiencyMode(environment, webview);
}

}  // namespace hp
