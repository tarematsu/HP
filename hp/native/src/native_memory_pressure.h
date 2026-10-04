#pragma once

#include "common.h"

namespace hp {

struct NativeMemoryPressureSnapshot {
  DWORD memoryLoad = 0;
  ULONGLONG availablePhysicalBytes = 0;
  ULONGLONG totalPhysicalBytes = 0;
  bool valid = false;
};

struct NativeWebViewMemoryPriorityResult {
  unsigned discovered = 0;
  unsigned adjusted = 0;
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

inline ULONGLONG NativeMemoryTotalMiB(
    const NativeMemoryPressureSnapshot& snapshot) noexcept {
  return snapshot.totalPhysicalBytes / (1024ULL * 1024ULL);
}

inline NativeWebViewMemoryPriorityResult ApplyNativeWebViewMemoryPriority(
    bool lowPriority) noexcept {
  NativeWebViewMemoryPriorityResult result;
  const DWORD rootProcessId = GetCurrentProcessId();
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE) return result;

  struct ProcessEntry {
    DWORD parentProcessId = 0;
    std::wstring executable;
  };
  std::map<DWORD, ProcessEntry> processes;
  PROCESSENTRY32W entry{};
  entry.dwSize = sizeof(entry);
  if (Process32FirstW(snapshot, &entry)) {
    do {
      processes[entry.th32ProcessID] =
          ProcessEntry{entry.th32ParentProcessID, entry.szExeFile};
    } while (Process32NextW(snapshot, &entry));
  }
  CloseHandle(snapshot);

  const auto belongsToCurrentProcess = [&processes, rootProcessId](DWORD processId) {
    DWORD cursor = processId;
    for (unsigned depth = 0; depth < 32; ++depth) {
      const auto found = processes.find(cursor);
      if (found == processes.end()) return false;
      const DWORD parent = found->second.parentProcessId;
      if (parent == rootProcessId) return true;
      if (parent == 0 || parent == cursor) return false;
      cursor = parent;
    }
    return false;
  };

  for (const auto& [processId, process] : processes) {
    if (_wcsicmp(process.executable.c_str(), L"msedgewebview2.exe") != 0 ||
        !belongsToCurrentProcess(processId)) {
      continue;
    }
    ++result.discovered;
    HANDLE handle = OpenProcess(PROCESS_SET_INFORMATION, FALSE, processId);
    if (!handle) continue;
    MEMORY_PRIORITY_INFORMATION priority{};
    priority.MemoryPriority =
        lowPriority ? MEMORY_PRIORITY_LOW : MEMORY_PRIORITY_NORMAL;
    if (SetProcessInformation(
            handle, ProcessMemoryPriority, &priority, sizeof(priority))) {
      ++result.adjusted;
    }
    CloseHandle(handle);
  }
  return result;
}

}  // namespace hp
