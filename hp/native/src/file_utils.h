#pragma once
#include "common.h"
#include <charconv>

namespace hp::file {
namespace detail {

template <typename T>
inline bool AppendDecimal(std::string& output, T value) noexcept {
  char buffer[64];
  const auto result = std::to_chars(buffer, buffer + sizeof(buffer), value);
  if (result.ec != std::errc{}) return false;
  output.append(buffer, result.ptr);
  return true;
}

}  // namespace detail

inline bool MatchesText(const fs::path& path, const std::string& content) {
  std::error_code error;
  if (!fs::is_regular_file(path, error) ||
      fs::file_size(path, error) != content.size()) {
    return false;
  }
  std::ifstream input(path, std::ios::binary);
  return input && std::equal(std::istreambuf_iterator<char>(input),
                             std::istreambuf_iterator<char>(),
                             content.begin(), content.end());
}

inline bool NonEmpty(const fs::path& path) {
  std::error_code error;
  return fs::is_regular_file(path, error) && fs::file_size(path, error) > 0;
}

inline std::string Stamp(const fs::path& path) {
  std::error_code error;
  const auto size = fs::file_size(path, error);
  if (error) return "missing";

  std::string stamp;
  stamp.reserve(48);
  if (!detail::AppendDecimal(stamp, size)) return "missing";
  const auto modified = fs::last_write_time(path, error);
  if (!error) {
    stamp.push_back(':');
    if (!detail::AppendDecimal(stamp, modified.time_since_epoch().count())) return "missing";
  }
  return stamp;
}

}  // namespace hp::file
