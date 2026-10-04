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

}  // namespace hp
