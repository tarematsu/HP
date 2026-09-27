#pragma once

#include "common.h"
#include <fstream>

namespace hp {

inline constexpr UINT kSpotifyArtistChartCaptureWakeMessage = WM_APP + 32;

namespace spotify_artist_chart_capture_spool {

inline constexpr size_t kMaxCaptureRecordBytes = 96 * 1024;
inline constexpr size_t kMaxCaptureRecords = 8;
inline constexpr size_t kCaptureUploadBatchSize = 4;

inline std::mutex& SpoolMutex() {
  static std::mutex mutex;
  return mutex;
}

inline fs::path DataDirectory() {
  constexpr DWORD kExecutablePathChars = 32768;
  std::vector<wchar_t> executable(kExecutablePathChars, L'\0');
  const DWORD length = GetModuleFileNameW(
      nullptr, executable.data(), static_cast<DWORD>(executable.size()));
  if (length == 0 || length >= executable.size()) return {};
  return fs::path(std::wstring(executable.data(), length)).parent_path() / L"data";
}

inline fs::path SpoolPath() {
  const fs::path directory = DataDirectory();
  return directory.empty() ? fs::path{} :
      directory / L"spotify-artist-jp-daily-capture.ndjson";
}

inline std::vector<std::string> ReadLinesLocked() {
  std::vector<std::string> lines;
  const fs::path path = SpoolPath();
  if (path.empty()) return lines;
  std::ifstream input(path, std::ios::binary);
  if (!input) return lines;
  std::string line;
  while (std::getline(input, line)) {
    if (line.empty() || line.size() > kMaxCaptureRecordBytes) continue;
    if (line.find('\r') != std::string::npos || line.find('\n') != std::string::npos) continue;
    lines.push_back(std::move(line));
    if (lines.size() > kMaxCaptureRecords) {
      lines.erase(lines.begin(), lines.begin() +
          static_cast<std::ptrdiff_t>(lines.size() - kMaxCaptureRecords));
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
  if (payload.empty()) return false;
  const std::string utf8 = WideToUtf8(std::wstring(payload));
  if (utf8.empty() || utf8.size() > kMaxCaptureRecordBytes ||
      utf8.find('\r') != std::string::npos || utf8.find('\n') != std::string::npos) {
    return false;
  }
  {
    std::lock_guard lock(SpoolMutex());
    auto lines = ReadLinesLocked();
    lines.push_back(utf8);
    if (lines.size() > kMaxCaptureRecords) {
      lines.erase(lines.begin(), lines.begin() +
          static_cast<std::ptrdiff_t>(lines.size() - kMaxCaptureRecords));
    }
    if (!WriteLinesLocked(lines)) return false;
  }
  if (HWND window = FindWindowW(L"HomePanelNativeWindow", nullptr)) {
    PostMessageW(window, kSpotifyArtistChartCaptureWakeMessage, 0, 0);
  }
  return true;
}

inline size_t Count() {
  std::lock_guard lock(SpoolMutex());
  return ReadLinesLocked().size();
}

inline std::vector<std::string> ReadBatch(size_t maximum = kCaptureUploadBatchSize) {
  std::lock_guard lock(SpoolMutex());
  auto lines = ReadLinesLocked();
  if (lines.size() > maximum) lines.resize(maximum);
  return lines;
}

inline bool Acknowledge(const std::vector<std::string>& batch, size_t count) {
  if (count == 0) return true;
  if (count > batch.size()) return false;
  std::lock_guard lock(SpoolMutex());
  auto lines = ReadLinesLocked();
  if (lines.size() < count ||
      !std::equal(batch.begin(), batch.begin() +
          static_cast<std::ptrdiff_t>(count), lines.begin())) {
    return false;
  }
  lines.erase(lines.begin(), lines.begin() + static_cast<std::ptrdiff_t>(count));
  return WriteLinesLocked(lines);
}

}  // namespace spotify_artist_chart_capture_spool
}  // namespace hp
