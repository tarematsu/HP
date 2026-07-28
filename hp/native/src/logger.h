#pragma once
#include "common.h"
namespace hp {
class Logger {
 public:
  explicit Logger(fs::path path, size_t maxBytes = 2 * 1024 * 1024, int rotations = 3);
  ~Logger();
  void Info(std::wstring_view message) noexcept { Write(L"INFO", message); }
  void Warn(std::wstring_view message) noexcept { Write(L"WARN", message); }
  void Error(std::wstring_view message) noexcept { Write(L"ERROR", message); }
  fs::path Path() const { return path_; }
 private:
  void Write(const wchar_t* level, std::wstring_view message) noexcept;
  void OpenOutput();
  void Rotate();
  fs::path path_;
  size_t maxBytes_;
  int rotations_;
  size_t currentBytes_ = 0;
  size_t pendingBytes_ = 0;
  std::ofstream output_;
  std::mutex mutex_;
};
}  // namespace hp
