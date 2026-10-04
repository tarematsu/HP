#pragma once

#include "common.h"

namespace hp {

struct NativeMemoryPressureSnapshot {
  DWORD memoryLoad = 0;
  ULONGLONG availablePhysicalBytes = 0;
  ULONGLONG totalPhysicalBytes = 0;
  bool valid = false;
};

inline NativeMemoryPressureSnapshot QueryNativeMemoryPressure() noexcept {
  MEMORYSTATUSEX status{};
  status.dwLength = sizeof(status);
  if (!GlobalMemoryStatusEx(&status)) return {};
  return NativeMemoryPressureSnapshot{
      status.dwMemoryLoad,
      status.ullAvailPhys,
      status.ullTotalPhys,
      true,
  };
}

inline bool NativeMemoryPressureShouldBeActive(
    const NativeMemoryPressureSnapshot& snapshot,
    bool currentlyActive) noexcept {
  if (!snapshot.valid) return currentlyActive;

  constexpr ULONGLONG kMiB = 1024ULL * 1024ULL;
  constexpr ULONGLONG kEnterAvailableBytes = 512ULL * kMiB;
  constexpr ULONGLONG kExitAvailableBytes = 768ULL * kMiB;
  constexpr DWORD kEnterMemoryLoad = 88;
  constexpr DWORD kExitMemoryLoad = 82;

  if (!currentlyActive) {
    return snapshot.availablePhysicalBytes <= kEnterAvailableBytes ||
        snapshot.memoryLoad >= kEnterMemoryLoad;
  }

  return !(snapshot.availablePhysicalBytes >= kExitAvailableBytes &&
           snapshot.memoryLoad <= kExitMemoryLoad);
}

inline ULONGLONG NativeMemoryAvailableMiB(
    const NativeMemoryPressureSnapshot& snapshot) noexcept {
  return snapshot.availablePhysicalBytes / (1024ULL * 1024ULL);
}

inline UINT NativeMemoryPressureMessage() noexcept {
  static const UINT message =
      RegisterWindowMessageW(L"HomePanel.NativeMemoryPressure.v1");
  return message;
}

inline void NotifyNativeMediaMemoryPressure(HWND root, bool active) noexcept {
  if (!root || !IsWindow(root)) return;
  const UINT message = NativeMemoryPressureMessage();
  if (message == 0) return;

  struct Payload {
    UINT message = 0;
    bool active = false;
  } payload{message, active};

  EnumChildWindows(
      root,
      [](HWND child, LPARAM parameter) -> BOOL {
        auto* payload = reinterpret_cast<Payload*>(parameter);
        if (!payload) return TRUE;
        wchar_t className[96]{};
        if (GetClassNameW(child, className, static_cast<int>(_countof(className))) <= 0 ||
            wcscmp(className, L"HomePanelNativeMvPanel") != 0) {
          return TRUE;
        }
        DWORD_PTR ignored = 0;
        SendMessageTimeoutW(
            child, payload->message, payload->active ? 1 : 0, 0,
            SMTO_ABORTIFHUNG | SMTO_BLOCK, 100, &ignored);
        return TRUE;
      },
      reinterpret_cast<LPARAM>(&payload));
}

}  // namespace hp
