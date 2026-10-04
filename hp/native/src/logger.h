#pragma once
#include "common.h"

namespace hp {

// Runtime file logging is intentionally disabled. Keep this tiny compatibility
// type so existing error-handling paths do not need to allocate a log file,
// format messages, lock a stream, flush, or rotate diagnostics on low-end hosts.
class Logger {
 public:
  explicit Logger(fs::path = {}, size_t = 0, int = 0) noexcept {}
  ~Logger() = default;

  void Info(std::wstring_view) const noexcept {}
  void Warn(std::wstring_view) const noexcept {}
  void Error(std::wstring_view) const noexcept {}
};

}  // namespace hp
