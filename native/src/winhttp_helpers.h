#pragma once

#include "common.h"

namespace hp {
// Reads a WinHTTP response header value of unknown length via the standard
// query-for-size-then-fetch pattern used by both the Cloudflare client and
// the artwork cache downloader.
inline std::wstring QueryHeaderValue(HINTERNET request, DWORD query) {
  DWORD size = 0;
  WinHttpQueryHeaders(request, query, WINHTTP_HEADER_NAME_BY_INDEX, nullptr, &size, WINHTTP_NO_HEADER_INDEX);
  if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || !size) return {};
  std::wstring value(size / sizeof(wchar_t), L'\0');
  if (!WinHttpQueryHeaders(request, query, WINHTTP_HEADER_NAME_BY_INDEX, value.data(), &size, WINHTTP_NO_HEADER_INDEX)) return {};
  value.resize(wcsnlen(value.c_str(), value.size()));
  return value;
}
}  // namespace hp
