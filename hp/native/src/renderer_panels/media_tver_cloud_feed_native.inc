// Minimal native TVer cloud-feed client shared by queue refresh workers.
// No series-page discovery or TVer platform API fallback lives here: the cloud
// collector is the single source of episode selection for native playback.
namespace {
constexpr size_t kNativeMediaTverMaximumFeedBytes = 2U * 1024U * 1024U;
constexpr wchar_t kNativeMediaTverCloudFeedUrl[] =
    L"https://homepanel-cloud.tarematsu.workers.dev/v1/native/tver-feed";
constexpr wchar_t kNativeMediaTverUserAgent[] =
    L"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    L"(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

struct NativeMediaTverComApartment {
  HRESULT result = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  ~NativeMediaTverComApartment() {
    if (SUCCEEDED(result)) CoUninitialize();
  }
};

bool NativeMediaTverIdIsSafe(std::wstring_view value) noexcept {
  return !value.empty() && value.size() <= 64 &&
      std::all_of(value.begin(), value.end(), [](wchar_t ch) {
        return (ch >= L'a' && ch <= L'z') ||
               (ch >= L'A' && ch <= L'Z') ||
               (ch >= L'0' && ch <= L'9') || ch == L'_' || ch == L'-';
      });
}

std::vector<uint8_t> NativeMediaTverFetchCloudFeed() {
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
  if (!WinHttpCrackUrl(kNativeMediaTverCloudFeedUrl, 0, 0, &parts) ||
      parts.nScheme != INTERNET_SCHEME_HTTPS) {
    throw std::runtime_error("invalid TVer cloud feed URL");
  }

  const std::wstring hostName(host, parts.dwHostNameLength);
  const std::wstring requestPath = WinHttpRequestPathFromUrl(parts);
  constexpr wchar_t kHeaders[] = L"Accept: application/json\r\n";

  for (const DWORD accessType : kWinHttpAccessTypes) {
    WinHttpHandle session(WinHttpOpen(
        kNativeMediaTverUserAgent, accessType,
        WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0));
    if (!session) continue;
    WinHttpSetTimeouts(session, 8000, 8000, 8000, 8000);
    DWORD protocols = WINHTTP_PROTOCOL_FLAG_HTTP2;
    WinHttpSetOption(
        session, WINHTTP_OPTION_ENABLE_HTTP_PROTOCOL, &protocols,
        sizeof(protocols));

    WinHttpHandle connection(
        WinHttpConnect(session, hostName.c_str(), parts.nPort, 0));
    if (!connection) continue;
    WinHttpHandle request(WinHttpOpenRequest(
        connection, L"GET", requestPath.c_str(), nullptr,
        L"https://tver.jp/", WINHTTP_DEFAULT_ACCEPT_TYPES,
        WINHTTP_FLAG_SECURE));
    if (!request) continue;

    DWORD decompression =
        WINHTTP_DECOMPRESSION_FLAG_GZIP | WINHTTP_DECOMPRESSION_FLAG_DEFLATE;
    WinHttpSetOption(
        request, WINHTTP_OPTION_DECOMPRESSION, &decompression,
        sizeof(decompression));
    if (!WinHttpSendRequest(
            request, kHeaders, static_cast<DWORD>(wcslen(kHeaders)),
            WINHTTP_NO_REQUEST_DATA, 0, 0, 0) ||
        !WinHttpReceiveResponse(request, nullptr)) {
      continue;
    }

    DWORD status = 0;
    DWORD statusBytes = sizeof(status);
    if (!WinHttpQueryHeaders(
            request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            WINHTTP_HEADER_NAME_BY_INDEX, &status, &statusBytes,
            WINHTTP_NO_HEADER_INDEX) || status != 200) {
      continue;
    }

    std::vector<uint8_t> response;
    for (;;) {
      DWORD available = 0;
      if (!WinHttpQueryDataAvailable(request, &available)) {
        response.clear();
        break;
      }
      if (!available) break;
      if (response.size() > kNativeMediaTverMaximumFeedBytes ||
          static_cast<size_t>(available) >
              kNativeMediaTverMaximumFeedBytes - response.size()) {
        response.clear();
        break;
      }
      const size_t offset = response.size();
      response.resize(offset + available);
      DWORD read = 0;
      if (!WinHttpReadData(
              request, response.data() + offset, available, &read)) {
        response.clear();
        break;
      }
      response.resize(offset + read);
      if (!read) break;
    }
    if (!response.empty()) return response;
  }
  throw std::runtime_error("TVer cloud feed request failed");
}

winrt::Windows::Data::Json::JsonObject NativeMediaTverParseCloudFeed(
    const std::vector<uint8_t>& bytes) {
  if (bytes.empty()) throw std::runtime_error("empty TVer cloud feed");
  const std::string text(
      reinterpret_cast<const char*>(bytes.data()), bytes.size());
  return winrt::Windows::Data::Json::JsonObject::Parse(Utf8ToWide(text));
}

std::vector<std::wstring> NativeMediaTverCloudFeedEpisodeIds(
    const winrt::Windows::Data::Json::JsonObject& root) {
  std::vector<std::wstring> ids;
  try {
    if (!root.HasKey(L"episodes") ||
        root.GetNamedValue(L"episodes").ValueType() !=
            winrt::Windows::Data::Json::JsonValueType::Array) {
      return ids;
    }
    constexpr std::wstring_view marker = L"https://tver.jp/episodes/";
    for (const auto& value : root.GetNamedArray(L"episodes")) {
      try {
        if (value.ValueType() !=
            winrt::Windows::Data::Json::JsonValueType::Object) {
          continue;
        }
        const std::wstring url =
            value.GetObject().GetNamedString(L"url", L"").c_str();
        if (url.compare(0, marker.size(), marker) != 0) continue;
        const size_t idStart = marker.size();
        const size_t idEnd = url.find_first_of(L"/?#", idStart);
        const std::wstring id = url.substr(
            idStart,
            idEnd == std::wstring::npos ? std::wstring::npos : idEnd - idStart);
        if (!NativeMediaTverIdIsSafe(id) ||
            std::find(ids.begin(), ids.end(), id) != ids.end()) {
          continue;
        }
        ids.push_back(id);
      } catch (...) {}
    }
  } catch (...) {
    ids.clear();
  }
  return ids;
}
}  // namespace
