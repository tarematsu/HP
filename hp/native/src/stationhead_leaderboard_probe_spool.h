#pragma once

#include "common.h"
#include <fstream>

namespace hp {

inline constexpr UINT kStationheadLeaderboardProbeWakeMessage = WM_APP + 31;

namespace stationhead_leaderboard_probe_spool {

inline constexpr size_t kMaxProbeRecordBytes = 72 * 1024;
inline constexpr size_t kMaxProbeRecords = 20;
inline constexpr size_t kProbeUploadBatchSize = 8;

inline std::mutex& SpoolMutex() {
  static std::mutex mutex;
  return mutex;
}

inline fs::path SpoolPath() {
  constexpr DWORD kExecutablePathChars = 32768;
  std::vector<wchar_t> executable(kExecutablePathChars, L'\0');
  const DWORD length = GetModuleFileNameW(
      nullptr, executable.data(), static_cast<DWORD>(executable.size()));
  if (length == 0 || length >= executable.size()) return {};
  return fs::path(std::wstring(executable.data(), length)).parent_path() /
         L"data" / L"stationhead-leaderboard-probe.ndjson";
}

inline std::vector<std::string> ReadLinesLocked() {
  std::vector<std::string> lines;
  const fs::path path = SpoolPath();
  if (path.empty()) return lines;
  std::ifstream input(path, std::ios::binary);
  if (!input) return lines;
  std::string line;
  while (std::getline(input, line)) {
    if (line.empty() || line.size() > kMaxProbeRecordBytes) continue;
    if (line.find('\r') != std::string::npos || line.find('\n') != std::string::npos) continue;
    lines.push_back(std::move(line));
    if (lines.size() > kMaxProbeRecords) {
      lines.erase(lines.begin(), lines.begin() +
          static_cast<std::ptrdiff_t>(lines.size() - kMaxProbeRecords));
    }
  }
  return lines;
}

inline bool WriteLinesLocked(const std::vector<std::string>& lines) {
  const fs::path path = SpoolPath();
  if (path.empty()) return false;
  std::error_code error;
  fs::create_directories(path.parent_path(), error);
  if (error) return false;
  if (lines.empty()) {
    fs::remove(path, error);
    return !error;
  }

  const fs::path temporary = path.wstring() + L".tmp";
  {
    std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
    if (!output) return false;
    for (const auto& line : lines) {
      output.write(line.data(), static_cast<std::streamsize>(line.size()));
      output.put('\n');
      if (!output) return false;
    }
    output.flush();
    if (!output) return false;
  }
  if (!MoveFileExW(temporary.c_str(), path.c_str(),
                   MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
    fs::remove(temporary, error);
    return false;
  }
  return true;
}

inline bool Append(std::wstring_view payload) {
  if (payload.empty() || payload.size() > kMaxProbeRecordBytes) return false;
  const std::string utf8 = WideToUtf8(std::wstring(payload));
  if (utf8.empty() || utf8.size() > kMaxProbeRecordBytes ||
      utf8.find('\r') != std::string::npos || utf8.find('\n') != std::string::npos) {
    return false;
  }
  {
    std::lock_guard lock(SpoolMutex());
    auto lines = ReadLinesLocked();
    lines.push_back(utf8);
    if (lines.size() > kMaxProbeRecords) {
      lines.erase(lines.begin(), lines.begin() +
          static_cast<std::ptrdiff_t>(lines.size() - kMaxProbeRecords));
    }
    if (!WriteLinesLocked(lines)) return false;
  }

  if (HWND window = FindWindowW(L"HomePanelNativeWindow", nullptr)) {
    PostMessageW(window, kStationheadLeaderboardProbeWakeMessage, 0, 0);
  }
  return true;
}

inline std::vector<std::string> ReadBatch(
    size_t maximum = kProbeUploadBatchSize) {
  std::lock_guard lock(SpoolMutex());
  auto lines = ReadLinesLocked();
  if (lines.size() > maximum) lines.resize(maximum);
  return lines;
}

inline bool Acknowledge(size_t count) {
  if (count == 0) return true;
  std::lock_guard lock(SpoolMutex());
  auto lines = ReadLinesLocked();
  const size_t consumed = std::min(count, lines.size());
  lines.erase(lines.begin(), lines.begin() + static_cast<std::ptrdiff_t>(consumed));
  return WriteLinesLocked(lines);
}

}  // namespace stationhead_leaderboard_probe_spool
}  // namespace hp
