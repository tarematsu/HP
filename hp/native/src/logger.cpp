#include "logger.h"

namespace hp {
namespace {
constexpr size_t kLogFlushThresholdBytes = 64 * 1024;

size_t FindHttpUrlStartCaseInsensitive(
    const std::wstring& value, size_t startAt) noexcept {
  static constexpr wchar_t kHttp[] = L"http://";
  static constexpr wchar_t kHttps[] = L"https://";
  for (size_t offset = startAt; offset < value.size(); ++offset) {
    const size_t remaining = value.size() - offset;
    if (remaining >= std::size(kHttps) - 1 &&
        _wcsnicmp(value.c_str() + offset, kHttps, std::size(kHttps) - 1) == 0) {
      return offset;
    }
    if (remaining >= std::size(kHttp) - 1 &&
        _wcsnicmp(value.c_str() + offset, kHttp, std::size(kHttp) - 1) == 0) {
      return offset;
    }
  }
  return std::wstring::npos;
}

std::wstring RedactUrlQueryAndFragment(const std::wstring& message) {
  std::wstring sanitized = message;
  size_t searchAt = 0;
  while (searchAt < sanitized.size()) {
    // Preserve the common lowercase fast path while also accepting mixed-case
    // schemes from external libraries or WebView diagnostics.
    const size_t httpAt = sanitized.find(L"http://", searchAt);
    const size_t httpsAt = sanitized.find(L"https://", searchAt);
    size_t urlAt = std::wstring::npos;
    if (httpAt == std::wstring::npos) urlAt = httpsAt;
    else if (httpsAt == std::wstring::npos) urlAt = httpAt;
    else urlAt = std::min(httpAt, httpsAt);
    const size_t caseInsensitiveAt =
        FindHttpUrlStartCaseInsensitive(sanitized, searchAt);
    if (urlAt == std::wstring::npos ||
        (caseInsensitiveAt != std::wstring::npos && caseInsensitiveAt < urlAt)) {
      urlAt = caseInsensitiveAt;
    }
    if (urlAt == std::wstring::npos) break;

    // Keep punctuation inside the redacted range. OAuth state and redirect
    // values can legally contain commas or bracket-like characters, so treating
    // them as URL terminators could expose the remainder of a query value.
    const size_t delimiterAt = sanitized.find_first_of(
        L" \t\r\n\"' <>", urlAt);
    const size_t urlEnd = delimiterAt == std::wstring::npos
        ? sanitized.size()
        : delimiterAt;
    const size_t sensitiveAt = sanitized.find_first_of(L"?#", urlAt);
    if (sensitiveAt == std::wstring::npos || sensitiveAt >= urlEnd) {
      searchAt = urlEnd;
      continue;
    }

    const std::wstring marker = L"?[redacted]";
    sanitized.replace(sensitiveAt, urlEnd - sensitiveAt, marker);
    searchAt = sensitiveAt + marker.size();
  }
  return sanitized;
}
}

Logger::Logger(fs::path path, size_t maxBytes, int rotations)
    : path_(std::move(path)), maxBytes_(maxBytes), rotations_(rotations) {
  fs::create_directories(path_.parent_path());
  std::error_code error;
  currentBytes_ = static_cast<size_t>(fs::file_size(path_, error));
  if (error) currentBytes_ = 0;
  if (maxBytes_ > 0 && currentBytes_ >= maxBytes_) {
    Rotate();
  } else {
    OpenOutput();
  }
}

Logger::~Logger() {
  std::lock_guard lock(mutex_);
  if (output_.is_open()) {
    output_.flush();
    output_.close();
  }
}

void Logger::OpenOutput() {
  if (output_.is_open()) return;
  output_.open(path_, std::ios::binary | std::ios::app);
}

void Logger::Rotate() {
  if (output_.is_open()) {
    output_.flush();
    output_.close();
  }

  std::error_code error;
  if (rotations_ <= 0) {
    fs::remove(path_, error);
  } else {
    fs::path oldest = path_;
    oldest += L"." + std::to_wstring(rotations_);
    fs::remove(oldest, error);
    error.clear();

    for (int index = rotations_ - 1; index >= 1; --index) {
      fs::path from = path_;
      from += L"." + std::to_wstring(index);
      fs::path to = path_;
      to += L"." + std::to_wstring(index + 1);
      if (!fs::exists(from, error) || error) {
        error.clear();
        continue;
      }
      fs::remove(to, error);
      error.clear();
      fs::rename(from, to, error);
      error.clear();
    }

    fs::path first = path_;
    first += L".1";
    fs::remove(first, error);
    error.clear();
    fs::rename(path_, first, error);
  }

  currentBytes_ = 0;
  pendingBytes_ = 0;
  OpenOutput();
}

void Logger::Write(const wchar_t* level, const std::wstring& message) noexcept {
  try {
    SYSTEMTIME time{};
    GetLocalTime(&time);
    char header[32]{};
    sprintf_s(header, "[%04u-%02u-%02u %02u:%02u:%02u] ",
              time.wYear, time.wMonth, time.wDay,
              time.wHour, time.wMinute, time.wSecond);

    std::string line = header;
    line += WideToUtf8(level);
    line.push_back(' ');
    line += WideToUtf8(RedactUrlQueryAndFragment(message));
    line.push_back('\n');

    std::lock_guard lock(mutex_);
    if (maxBytes_ > 0 && currentBytes_ > 0 &&
        line.size() > maxBytes_ - std::min(currentBytes_, maxBytes_)) {
      Rotate();
    }
    OpenOutput();
    if (!output_.is_open()) return;

    output_.write(line.data(), static_cast<std::streamsize>(line.size()));
    if (!output_) {
      output_.close();
      return;
    }
    currentBytes_ += line.size();
    pendingBytes_ += line.size();

    const bool important = _wcsicmp(level, L"INFO") != 0;
    if (important || pendingBytes_ >= kLogFlushThresholdBytes) {
      output_.flush();
      pendingBytes_ = 0;
    }
  } catch (...) {
    // Logging is called from WndProc, COM callbacks, terminate handlers and
    // worker exception paths. Diagnostics must never become a second failure
    // that terminates the process while handling the original problem.
  }
}

}  // namespace hp
