#include "logger.h"
namespace hp {
Logger::Logger(fs::path path, size_t maxBytes, int rotations) : path_(std::move(path)), maxBytes_(maxBytes), rotations_(rotations) {
  fs::create_directories(path_.parent_path());
}
void Logger::RotateIfNeeded() {
  std::error_code ec;
  if (!fs::exists(path_, ec) || fs::file_size(path_, ec) < maxBytes_) return;
  for (int index = rotations_ - 1; index >= 1; --index) {
    fs::path from = path_; from += L"." + std::to_wstring(index);
    fs::path to = path_; to += L"." + std::to_wstring(index + 1);
    fs::rename(from, to, ec); ec.clear();
  }
  fs::path first = path_; first += L".1";
  fs::rename(path_, first, ec);
}
void Logger::Write(const wchar_t* level, const std::wstring& message) {
  std::lock_guard lock(mutex_);
  RotateIfNeeded();
  SYSTEMTIME time{}; GetLocalTime(&time);
  // Write UTF-8 bytes directly: the previous wofstream relied on the C-locale
  // codecvt, which fails on any non-ASCII character and silently dropped the
  // rest of the line (Japanese text, version strings from the cloud, etc.).
  char header[32]{};
  sprintf_s(header, "[%04u-%02u-%02u %02u:%02u:%02u] ", time.wYear, time.wMonth, time.wDay,
            time.wHour, time.wMinute, time.wSecond);
  std::ofstream output(path_, std::ios::binary | std::ios::app);
  output << header << WideToUtf8(level) << ' ' << WideToUtf8(message) << '\n';
}
}
