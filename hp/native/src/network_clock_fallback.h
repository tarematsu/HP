#pragma once

#include "winhttp_helpers.h"
#include <iterator>

namespace hp {

inline constexpr wchar_t kNetworkClockOffsetFileName[] =
    L"network-clock-offset-ms.txt";
inline constexpr long double kNetworkClockOffsetPersistThresholdMs = 2000.0L;

struct NetworkClockOffsetPersistenceState {
  std::mutex mutex;
  fs::path path;
  bool hasOffset = false;
  int64_t offsetMs = 0;
};

inline NetworkClockOffsetPersistenceState& GlobalNetworkClockOffsetPersistenceState() noexcept {
  static NetworkClockOffsetPersistenceState state;
  return state;
}

inline fs::path DefaultNetworkClockOffsetPath() {
  wchar_t executable[MAX_PATH * 4]{};
  if (GetModuleFileNameW(nullptr, executable, _countof(executable)) == 0) {
    return fs::path(L"data") / kNetworkClockOffsetFileName;
  }
  return fs::path(executable).parent_path() / L"data" /
      kNetworkClockOffsetFileName;
}

inline bool WindowsWallClockUnixMillis(int64_t* output) noexcept {
  if (!output) return false;
  FILETIME fileTime{};
  GetSystemTimeAsFileTime(&fileTime);
  ULARGE_INTEGER ticks{};
  ticks.LowPart = fileTime.dwLowDateTime;
  ticks.HighPart = fileTime.dwHighDateTime;
  constexpr uint64_t kUnixEpochFileTime = 116'444'736'000'000'000ULL;
  if (ticks.QuadPart < kUnixEpochFileTime) return false;
  const uint64_t millis = (ticks.QuadPart - kUnixEpochFileTime) / 10'000ULL;
  if (millis > static_cast<uint64_t>(std::numeric_limits<int64_t>::max())) {
    return false;
  }
  *output = static_cast<int64_t>(millis);
  return true;
}

inline bool AddNetworkClockOffset(int64_t baseMs, int64_t offsetMs,
                                  int64_t* output) noexcept {
  if (!output) return false;
  if (offsetMs > 0 &&
      baseMs > std::numeric_limits<int64_t>::max() - offsetMs) {
    return false;
  }
  if (offsetMs < 0 &&
      baseMs < std::numeric_limits<int64_t>::min() - offsetMs) {
    return false;
  }
  *output = baseMs + offsetMs;
  return true;
}

inline bool ReadNetworkClockOffset(const fs::path& path,
                                   int64_t* output) noexcept {
  if (!output) return false;
  try {
    std::ifstream input(path, std::ios::binary);
    if (!input) return false;
    std::string text((std::istreambuf_iterator<char>(input)), {});
    if (text.empty() || text.size() > 64) return false;
    std::istringstream parser(text);
    int64_t value = 0;
    std::string extra;
    if (!(parser >> value)) return false;
    if (parser >> extra) return false;
    *output = value;
    return true;
  } catch (...) {
    return false;
  }
}

inline bool BootstrapNetworkClockFromPersistedOffset() noexcept {
  try {
    const fs::path path = DefaultNetworkClockOffsetPath();
    int64_t offsetMs = 0;
    const bool loaded = ReadNetworkClockOffset(path, &offsetMs);

    NetworkClockOffsetPersistenceState& persistence =
        GlobalNetworkClockOffsetPersistenceState();
    {
      std::lock_guard lock(persistence.mutex);
      persistence.path = path;
      persistence.hasOffset = loaded;
      persistence.offsetMs = loaded ? offsetMs : 0;
    }
    if (!loaded) return false;

    int64_t windowsUnixMs = 0;
    int64_t correctedUnixMs = 0;
    if (!WindowsWallClockUnixMillis(&windowsUnixMs) ||
        !AddNetworkClockOffset(windowsUnixMs, offsetMs, &correctedUnixMs)) {
      return false;
    }

    // The persisted value is network UTC minus Windows UTC. Use Windows only
    // once to reconstruct an initial trusted-enough anchor when the app starts
    // offline, then advance from GetTickCount64() so later wall-clock changes
    // cannot move the displayed clock during this process lifetime.
    NetworkClockState& clock = GlobalNetworkClockState();
    std::lock_guard lock(clock.mutex);
    if (!clock.synchronized) {
      clock.anchorUnixMs = correctedUnixMs;
      clock.anchorTickMs = GetTickCount64();
      clock.synchronized = true;
    }
    return true;
  } catch (...) {
    return false;
  }
}

inline bool PersistNetworkClockOffsetFromHttpResponse(HINTERNET request) noexcept {
  if (!request) return false;
  try {
    SYSTEMTIME serverUtc{};
    DWORD size = sizeof(serverUtc);
    if (!WinHttpQueryHeaders(
            request, WINHTTP_QUERY_DATE | WINHTTP_QUERY_FLAG_SYSTEMTIME,
            WINHTTP_HEADER_NAME_BY_INDEX, &serverUtc, &size,
            WINHTTP_NO_HEADER_INDEX)) {
      return false;
    }

    int64_t serverUnixMs = 0;
    int64_t windowsUnixMs = 0;
    if (!UnixMillisFromUtcSystemTime(serverUtc, &serverUnixMs) ||
        serverUnixMs > std::numeric_limits<int64_t>::max() - 500 ||
        !WindowsWallClockUnixMillis(&windowsUnixMs)) {
      return false;
    }

    // HTTP Date is second-granularity, matching the live network-clock anchor.
    const int64_t networkUnixMs = serverUnixMs + 500;
    const int64_t offsetMs = networkUnixMs - windowsUnixMs;

    NetworkClockOffsetPersistenceState& persistence =
        GlobalNetworkClockOffsetPersistenceState();
    fs::path path;
    bool shouldPersist = false;
    {
      std::lock_guard lock(persistence.mutex);
      if (persistence.path.empty()) persistence.path = DefaultNetworkClockOffsetPath();
      path = persistence.path;
      shouldPersist = !persistence.hasOffset ||
          std::fabs(static_cast<long double>(offsetMs) -
                    static_cast<long double>(persistence.offsetMs)) >=
              kNetworkClockOffsetPersistThresholdMs;
    }
    if (!shouldPersist) return true;

    if (!AtomicWriteText(path, std::to_string(offsetMs) + "\n")) return false;
    {
      std::lock_guard lock(persistence.mutex);
      persistence.hasOffset = true;
      persistence.offsetMs = offsetMs;
    }
    return true;
  } catch (...) {
    return false;
  }
}

}  // namespace hp
