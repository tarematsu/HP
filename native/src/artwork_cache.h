#pragma once

#include "common.h"
#include "winhttp_helpers.h"

namespace hp {
inline std::wstring ArtworkCacheRequestPathFromUrl(
    const URL_COMPONENTS& parts) {
  std::wstring path;
  if (parts.lpszUrlPath && parts.dwUrlPathLength) {
    path.assign(parts.lpszUrlPath, parts.dwUrlPathLength);
  }
  if (path.empty()) path = L"/";
  if (parts.lpszExtraInfo && parts.dwExtraInfoLength) {
    path.append(parts.lpszExtraInfo, parts.dwExtraInfoLength);
  }
  return path;
}

inline std::wstring GuessArtworkExtension(const std::wstring& contentType,
                                          const std::wstring& url) {
  const std::wstring loweredType = [&] {
    std::wstring value = contentType;
    std::transform(value.begin(), value.end(), value.begin(), towlower);
    return value;
  }();
  if (loweredType.find(L"image/png") != std::wstring::npos) return L".png";
  if (loweredType.find(L"image/webp") != std::wstring::npos) return L".webp";
  if (loweredType.find(L"image/gif") != std::wstring::npos) return L".gif";
  if (loweredType.find(L"image/bmp") != std::wstring::npos) return L".bmp";
  if (loweredType.find(L"image/jpeg") != std::wstring::npos ||
      loweredType.find(L"image/jpg") != std::wstring::npos) {
    return L".jpg";
  }

  const size_t query = url.find_first_of(L"?#");
  const std::wstring path = url.substr(0, query);
  const size_t dot = path.find_last_of(L'.');
  if (dot != std::wstring::npos) {
    std::wstring extension = path.substr(dot);
    std::transform(
        extension.begin(), extension.end(), extension.begin(), towlower);
    if (extension == L".png" || extension == L".jpg" ||
        extension == L".jpeg" || extension == L".webp" ||
        extension == L".gif" || extension == L".bmp") {
      return extension == L".jpeg" ? L".jpg" : extension;
    }
  }
  return L".img";
}

inline bool DownloadUrlBytes(const wchar_t* rawUrl, size_t maximumBytes,
                             std::vector<uint8_t>* body,
                             std::wstring* contentType,
                             const wchar_t* userAgent) {
  if (!rawUrl || !*rawUrl || !body) return false;
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
  if (!WinHttpCrackUrl(rawUrl, 0, 0, &parts)) return false;

  const std::wstring requestPath = ArtworkCacheRequestPathFromUrl(parts);
  for (DWORD accessType :
       {WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_ACCESS_TYPE_NO_PROXY}) {
    HINTERNET session = WinHttpOpen(
        userAgent ? userAgent : L"HomePanel-Artwork-Cache/1.0", accessType,
        WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!session) continue;
    HINTERNET connection = WinHttpConnect(
        session, std::wstring(host, parts.dwHostNameLength).c_str(),
        parts.nPort, 0);
    if (!connection) {
      WinHttpCloseHandle(session);
      continue;
    }
    HINTERNET request = WinHttpOpenRequest(
        connection, L"GET", requestPath.c_str(), nullptr, WINHTTP_NO_REFERER,
        WINHTTP_DEFAULT_ACCEPT_TYPES,
        parts.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0);
    if (!request) {
      WinHttpCloseHandle(connection);
      WinHttpCloseHandle(session);
      continue;
    }

    WinHttpSetTimeouts(request, 8000, 8000, 8000, 8000);
    DWORD decompression =
        WINHTTP_DECOMPRESSION_FLAG_GZIP | WINHTTP_DECOMPRESSION_FLAG_DEFLATE;
    WinHttpSetOption(
        request, WINHTTP_OPTION_DECOMPRESSION, &decompression,
        sizeof(decompression));
    const BOOL sent = WinHttpSendRequest(
        request, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0,
        0, 0);
    const BOOL received = sent && WinHttpReceiveResponse(request, nullptr);
    if (!received) {
      WinHttpCloseHandle(request);
      WinHttpCloseHandle(connection);
      WinHttpCloseHandle(session);
      continue;
    }

    DWORD status = 0;
    DWORD statusSize = sizeof(status);
    WinHttpQueryHeaders(
        request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
        WINHTTP_HEADER_NAME_BY_INDEX, &status, &statusSize,
        WINHTTP_NO_HEADER_INDEX);
    if (status != 200) {
      WinHttpCloseHandle(request);
      WinHttpCloseHandle(connection);
      WinHttpCloseHandle(session);
      continue;
    }

    if (contentType) {
      *contentType = QueryHeaderValue(request, WINHTTP_QUERY_CONTENT_TYPE);
    }
    bool ok = true;
    for (;;) {
      DWORD available = 0;
      if (!WinHttpQueryDataAvailable(request, &available)) {
        ok = false;
        break;
      }
      if (!available) break;
      if (body->size() + available > maximumBytes) {
        ok = false;
        break;
      }
      const size_t offset = body->size();
      body->resize(offset + available);
      DWORD read = 0;
      if (!WinHttpReadData(
              request, body->data() + offset, available, &read)) {
        ok = false;
        break;
      }
      body->resize(offset + read);
      if (!read) break;
    }

    WinHttpCloseHandle(request);
    WinHttpCloseHandle(connection);
    WinHttpCloseHandle(session);
    if (ok && !body->empty()) return true;
    body->clear();
  }

  return false;
}

inline std::wstring CacheArtworkUrl(const fs::path& dataDir,
                                    const std::wstring& artworkUrl,
                                    const wchar_t* userAgent =
                                        L"HomePanel-Artwork-Cache/1.0") {
  if (artworkUrl.empty()) return {};
  if (artworkUrl.rfind(L"https://data.homepanel/", 0) == 0) return artworkUrl;

  const std::string key = WideToUtf8(artworkUrl);
  if (key.empty()) return artworkUrl;

  const std::wstring stem = Hex64(Fnv1a64(key));
  const fs::path cacheDir = dataDir / L"spotify-artwork-cache";
  std::error_code error;
  fs::create_directories(cacheDir, error);

  for (const wchar_t* extension :
       {L".jpg", L".png", L".webp", L".gif", L".bmp", L".img"}) {
    const fs::path cached = cacheDir / (stem + extension);
    if (fs::is_regular_file(cached, error) &&
        fs::file_size(cached, error) > 0) {
      return L"https://data.homepanel/spotify-artwork-cache/" +
          cached.filename().wstring();
    }
    error.clear();
  }

  std::vector<uint8_t> bytes;
  std::wstring contentType;
  if (!DownloadUrlBytes(
          artworkUrl.c_str(), 8 * 1024 * 1024, &bytes, &contentType,
          userAgent)) {
    return artworkUrl;
  }

  const fs::path cached =
      cacheDir / (stem + GuessArtworkExtension(contentType, artworkUrl));
  if (!AtomicWriteBytes(cached, bytes)) return artworkUrl;
  return L"https://data.homepanel/spotify-artwork-cache/" +
      cached.filename().wstring();
}
}  // namespace hp
