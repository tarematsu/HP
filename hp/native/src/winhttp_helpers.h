#pragma once

#include "common.h"
#include <limits>

namespace hp {

inline constexpr DWORD kWinHttpAccessTypes[] = {
    WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
    WINHTTP_ACCESS_TYPE_NO_PROXY,
};

inline std::wstring QueryHeaderValue(HINTERNET request, DWORD query) {
  DWORD size = 0;
  WinHttpQueryHeaders(request, query, WINHTTP_HEADER_NAME_BY_INDEX, nullptr, &size, WINHTTP_NO_HEADER_INDEX);
  if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || !size) return {};
  std::wstring value(size / sizeof(wchar_t), L'\0');
  if (!WinHttpQueryHeaders(request, query, WINHTTP_HEADER_NAME_BY_INDEX, value.data(), &size, WINHTTP_NO_HEADER_INDEX)) return {};
  value.resize(wcsnlen(value.c_str(), value.size()));
  return value;
}

struct NetworkClockState {
  std::mutex mutex;
  bool synchronized = false;
  int64_t anchorUnixMs = 0;
  ULONGLONG anchorTickMs = 0;
};

inline NetworkClockState& GlobalNetworkClockState() noexcept {
  static NetworkClockState state;
  return state;
}

inline bool UnixMillisFromUtcSystemTime(const SYSTEMTIME& utc, int64_t* output) noexcept {
  if (!output) return false;
  FILETIME fileTime{};
  if (!SystemTimeToFileTime(&utc, &fileTime)) return false;
  ULARGE_INTEGER ticks{};
  ticks.LowPart = fileTime.dwLowDateTime;
  ticks.HighPart = fileTime.dwHighDateTime;
  constexpr uint64_t kUnixEpochFileTime = 116'444'736'000'000'000ULL;
  if (ticks.QuadPart < kUnixEpochFileTime) return false;
  *output = static_cast<int64_t>((ticks.QuadPart - kUnixEpochFileTime) / 10'000ULL);
  return true;
}

inline bool UtcSystemTimeFromUnixMillis(int64_t unixMs, SYSTEMTIME* output) noexcept {
  if (!output || unixMs < 0) return false;
  constexpr uint64_t kUnixEpochFileTime = 116'444'736'000'000'000ULL;
  constexpr uint64_t kTicksPerMillisecond = 10'000ULL;
  const uint64_t value = static_cast<uint64_t>(unixMs);
  if (value > (std::numeric_limits<uint64_t>::max() - kUnixEpochFileTime) /
                  kTicksPerMillisecond) {
    return false;
  }
  ULARGE_INTEGER ticks{};
  ticks.QuadPart = kUnixEpochFileTime + value * kTicksPerMillisecond;
  FILETIME fileTime{};
  fileTime.dwLowDateTime = ticks.LowPart;
  fileTime.dwHighDateTime = ticks.HighPart;
  return FileTimeToSystemTime(&fileTime, output) != FALSE;
}

inline bool SynchronizeNetworkClockFromHttpResponse(HINTERNET request) noexcept {
  if (!request) return false;
  SYSTEMTIME serverUtc{};
  DWORD size = sizeof(serverUtc);
  if (!WinHttpQueryHeaders(
          request, WINHTTP_QUERY_DATE | WINHTTP_QUERY_FLAG_SYSTEMTIME,
          WINHTTP_HEADER_NAME_BY_INDEX, &serverUtc, &size,
          WINHTTP_NO_HEADER_INDEX)) {
    return false;
  }
  int64_t serverUnixMs = 0;
  if (!UnixMillisFromUtcSystemTime(serverUtc, &serverUnixMs)) return false;

  // HTTP Date has one-second resolution. Anchor at the middle of that second,
  // then advance only with the monotonic uptime counter. Windows wall-clock and
  // timezone changes therefore cannot move the dashboard clock.
  NetworkClockState& state = GlobalNetworkClockState();
  std::lock_guard lock(state.mutex);
  state.anchorUnixMs = serverUnixMs + 500;
  state.anchorTickMs = GetTickCount64();
  state.synchronized = true;
  return true;
}

inline bool NetworkClockUnixMillis(int64_t* output) noexcept {
  if (!output) return false;
  NetworkClockState& state = GlobalNetworkClockState();
  std::lock_guard lock(state.mutex);
  if (!state.synchronized) return false;
  const ULONGLONG nowTick = GetTickCount64();
  const ULONGLONG elapsed = nowTick - state.anchorTickMs;
  if (elapsed > static_cast<ULONGLONG>(std::numeric_limits<int64_t>::max()) ||
      state.anchorUnixMs > std::numeric_limits<int64_t>::max() -
                               static_cast<int64_t>(elapsed)) {
    return false;
  }
  *output = state.anchorUnixMs + static_cast<int64_t>(elapsed);
  return true;
}

inline bool NetworkClockJstNow(SYSTEMTIME* output) noexcept {
  if (!output) return false;
  int64_t utcMs = 0;
  if (!NetworkClockUnixMillis(&utcMs)) return false;
  constexpr int64_t kJstOffsetMs = 9LL * 60 * 60 * 1000;
  if (utcMs > std::numeric_limits<int64_t>::max() - kJstOffsetMs) return false;
  return UtcSystemTimeFromUnixMillis(utcMs + kJstOffsetMs, output);
}

inline UINT NetworkClockDelayToNextSecond() noexcept {
  int64_t nowMs = 0;
  if (!NetworkClockUnixMillis(&nowMs)) return 250;
  const UINT milliseconds = static_cast<UINT>(nowMs % 1000);
  return std::max<UINT>(USER_TIMER_MINIMUM, 1000U - milliseconds);
}

struct WinHttpHandle {
  HINTERNET value = nullptr;
  WinHttpHandle() = default;
  explicit WinHttpHandle(HINTERNET handle) : value(handle) {}
  ~WinHttpHandle() { if (value) WinHttpCloseHandle(value); }
  WinHttpHandle(const WinHttpHandle&) = delete;
  WinHttpHandle& operator=(const WinHttpHandle&) = delete;
  operator HINTERNET() const noexcept { return value; }
};

inline std::wstring WinHttpRequestPathFromUrl(const URL_COMPONENTS& parts) {
  const size_t pathLength = parts.lpszUrlPath ? parts.dwUrlPathLength : 0;
  const size_t extraLength = parts.lpszExtraInfo ? parts.dwExtraInfoLength : 0;
  std::wstring path;
  path.reserve(std::max<size_t>(1, pathLength) + extraLength);
  if (pathLength) path.assign(parts.lpszUrlPath, pathLength);
  else path.push_back(L'/');
  if (extraLength) path.append(parts.lpszExtraInfo, extraLength);
  return path;
}

inline bool WinHttpDownload(const wchar_t* rawUrl, size_t maximumBytes,
                            std::vector<uint8_t>* body,
                            std::wstring* contentType = nullptr,
                            std::wstring* error = nullptr,
                            const wchar_t* userAgent = L"HomePanel/1.0",
                            const wchar_t* extraHeaders = nullptr) {
  const auto fail = [error](std::wstring message) {
    if (error) *error = std::move(message);
    return false;
  };
  const auto lastError = [](const wchar_t* stage) {
    return std::wstring(stage) + L" failed: " + std::to_wstring(GetLastError());
  };
  if (!rawUrl || !*rawUrl || !body) return fail(L"URL missing");
  body->clear();
  if (contentType) contentType->clear();

  URL_COMPONENTS parts{sizeof(parts)};
  wchar_t host[256]{};
  wchar_t path[4096]{};
  wchar_t extra[2048]{};
  parts.lpszHostName = host;
  parts.dwHostNameLength = _countof(host);
  parts.lpszUrlPath = path;
  parts.dwUrlPathLength = _countof(path);
  parts.lpszExtraInfo = extra;
  parts.dwExtraInfoLength = _countof(extra);
  if (!WinHttpCrackUrl(rawUrl, 0, 0, &parts)) return fail(lastError(L"WinHttpCrackUrl"));
  const std::wstring hostName(host, parts.dwHostNameLength);
  const std::wstring requestPath = WinHttpRequestPathFromUrl(parts);
  const DWORD extraHeaderLength = extraHeaders
      ? static_cast<DWORD>(wcslen(extraHeaders))
      : 0;

  std::wstring failure = L"WinHTTP request failed";
  for (const DWORD accessType : kWinHttpAccessTypes) {
    WinHttpHandle session(WinHttpOpen(userAgent, accessType,
                                      WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0));
    if (!session) { failure = lastError(L"WinHttpOpen"); continue; }
    DWORD protocols = WINHTTP_PROTOCOL_FLAG_HTTP2;
    WinHttpSetOption(session, WINHTTP_OPTION_ENABLE_HTTP_PROTOCOL, &protocols, sizeof(protocols));

    WinHttpHandle connection(WinHttpConnect(session, hostName.c_str(), parts.nPort, 0));
    if (!connection) { failure = lastError(L"WinHttpConnect"); continue; }

    WinHttpHandle request(WinHttpOpenRequest(
        connection, L"GET", requestPath.c_str(), nullptr, WINHTTP_NO_REFERER,
        WINHTTP_DEFAULT_ACCEPT_TYPES,
        parts.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0));
    if (!request) { failure = lastError(L"WinHttpOpenRequest"); continue; }

    WinHttpSetTimeouts(request, 8000, 8000, 8000, 8000);
    DWORD decompression = WINHTTP_DECOMPRESSION_FLAG_GZIP | WINHTTP_DECOMPRESSION_FLAG_DEFLATE;
    WinHttpSetOption(request, WINHTTP_OPTION_DECOMPRESSION, &decompression, sizeof(decompression));
    if (!WinHttpSendRequest(request, extraHeaders, extraHeaderLength,
                            WINHTTP_NO_REQUEST_DATA, 0, 0, 0) ||
        !WinHttpReceiveResponse(request, nullptr)) {
      failure = lastError(L"WinHttpReceiveResponse");
      continue;
    }

    DWORD status = 0;
    DWORD statusSize = sizeof(status);
    WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                        WINHTTP_HEADER_NAME_BY_INDEX, &status, &statusSize, WINHTTP_NO_HEADER_INDEX);
    if (status != 200) {
      failure = L"HTTP " + std::to_wstring(status);
      continue;
    }

    DWORD contentLength = 0;
    DWORD contentLengthSize = sizeof(contentLength);
    if (WinHttpQueryHeaders(
            request, WINHTTP_QUERY_CONTENT_LENGTH | WINHTTP_QUERY_FLAG_NUMBER,
            WINHTTP_HEADER_NAME_BY_INDEX, &contentLength, &contentLengthSize,
            WINHTTP_NO_HEADER_INDEX)) {
      if (static_cast<size_t>(contentLength) > maximumBytes) {
        failure = L"response too large";
        continue;
      }
      if (contentLength) body->reserve(contentLength);
    }
    if (contentType) *contentType = QueryHeaderValue(request, WINHTTP_QUERY_CONTENT_TYPE);

    bool readOk = true;
    for (;;) {
      DWORD available = 0;
      if (!WinHttpQueryDataAvailable(request, &available)) {
        failure = lastError(L"WinHttpQueryDataAvailable");
        readOk = false;
        break;
      }
      if (!available) break;
      if (body->size() > maximumBytes ||
          static_cast<size_t>(available) > maximumBytes - body->size()) {
        failure = L"response too large";
        readOk = false;
        break;
      }
      const size_t offset = body->size();
      body->resize(offset + available);
      DWORD read = 0;
      if (!WinHttpReadData(request, body->data() + offset, available, &read)) {
        failure = lastError(L"WinHttpReadData");
        readOk = false;
        break;
      }
      body->resize(offset + read);
      if (!read) break;
    }
    if (readOk && !body->empty()) return true;
    if (readOk) failure = L"empty response";
    body->clear();
  }
  return fail(std::move(failure));
}

inline bool WinHttpDownload(const std::wstring& rawUrl, size_t maximumBytes,
                            std::vector<uint8_t>* body,
                            std::wstring* contentType = nullptr,
                            std::wstring* error = nullptr,
                            const wchar_t* userAgent = L"HomePanel/1.0",
                            const wchar_t* extraHeaders = nullptr) {
  return WinHttpDownload(rawUrl.c_str(), maximumBytes, body, contentType, error,
                         userAgent, extraHeaders);
}
}  // namespace hp
