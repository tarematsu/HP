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
  std::wofstream output(path_, std::ios::app);
  output << L'[' << std::setfill(L'0') << std::setw(4) << time.wYear << L'-' << std::setw(2) << time.wMonth << L'-' << std::setw(2) << time.wDay
         << L' ' << std::setw(2) << time.wHour << L':' << std::setw(2) << time.wMinute << L':' << std::setw(2) << time.wSecond << L"] " << level << L" " << message << L'\n';
}
}
