// Native TVer series resolver. DOM interaction and playback remain WebView
// responsibilities; this module first consumes the cloud-collected Sakurazaka
// episode feed, then falls back to the existing series API chain if unavailable.
namespace {
constexpr ULONGLONG kNativeMediaTverSeriesRetryMs = 15'000ULL;
constexpr size_t kNativeMediaTverMaximumApiBytes = 2U * 1024U * 1024U;
constexpr wchar_t kNativeMediaTverCloudFeedUrl[] =
    L"https://homepanel-cloud.tarematsu.workers.dev/v1/native/tver-feed";
constexpr wchar_t kNativeMediaTverUserAgent[] =
    L"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    L"(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

struct NativeMediaTverSeriesResolution {
  std::wstring seriesId;
  std::vector<std::wstring> episodeIds;
  bool success = false;
};

struct NativeMediaTverSeriesResolverState {
  std::mutex mutex;
  ICoreWebView2* webviewIdentity = nullptr;  // Identity only; never dereferenced by worker.
  std::wstring seriesId;
  uint64_t generation = 0;
  bool inFlight = false;
  bool navigationPending = false;
  ULONGLONG failedAt = 0;
  std::optional<NativeMediaTverSeriesResolution> ready;
};

struct NativeMediaTverComApartment {
  HRESULT result = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  ~NativeMediaTverComApartment() {
    if (SUCCEEDED(result)) CoUninitialize();
  }
};

NativeMediaTverSeriesResolverState& NativeMediaTverSeriesResolver() {
  static NativeMediaTverSeriesResolverState state;
  return state;
}

bool NativeMediaTverIdIsSafe(std::wstring_view value) noexcept {
  return !value.empty() && value.size() <= 64 &&
      std::all_of(value.begin(), value.end(), [](wchar_t ch) {
        return (ch >= L'a' && ch <= L'z') ||
               (ch >= L'A' && ch <= L'Z') ||
               (ch >= L'0' && ch <= L'9');
      });
}

std::optional<std::wstring> NativeMediaTverSeriesIdFromWebView(
    ICoreWebView2* webview) noexcept {
  if (!webview) return std::nullopt;
  LPWSTR rawSource = nullptr;
  if (FAILED(webview->get_Source(&rawSource)) || !rawSource) return std::nullopt;
  const std::wstring source(rawSource);
  CoTaskMemFree(rawSource);
  constexpr std::wstring_view marker = L"https://tver.jp/series/";
  const size_t start = source.find(marker);
  if (start == std::wstring::npos) return std::nullopt;
  const size_t idStart = start + marker.size();
  const size_t idEnd = source.find_first_of(L"/?#", idStart);
  const std::wstring id = source.substr(
      idStart, idEnd == std::wstring::npos ? std::wstring::npos : idEnd - idStart);
  return NativeMediaTverIdIsSafe(id) ? std::optional<std::wstring>(id)
                                     : std::nullopt;
}

std::wstring NativeMediaTverPercentEncode(std::wstring_view value) {
  const std::string utf8 = WideToUtf8(std::wstring(value));
  static constexpr char kHex[] = "0123456789ABCDEF";
  std::string encoded;
  encoded.reserve(utf8.size() * 3);
  for (const unsigned char ch : utf8) {
    const bool unreserved =
        (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') ||
        (ch >= '0' && ch <= '9') || ch == '-' || ch == '_' ||
        ch == '.' || ch == '~';
    if (unreserved) {
      encoded.push_back(static_cast<char>(ch));
    } else {
      encoded.push_back('%');
      encoded.push_back(kHex[ch >> 4]);
      encoded.push_back(kHex[ch & 0x0F]);
    }
  }
  return Utf8ToWide(encoded);
}

std::vector<uint8_t> NativeMediaTverHttpRequest(
    const wchar_t* method, const std::wstring& rawUrl,
    const wchar_t* extraHeaders, std::string_view requestBody = {}) {
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
  if (!WinHttpCrackUrl(rawUrl.c_str(), 0, 0, &parts) ||
      parts.nScheme != INTERNET_SCHEME_HTTPS || requestBody.size() > MAXDWORD) {
    throw std::runtime_error("invalid TVer API request");
  }
  const std::wstring hostName(host, parts.dwHostNameLength);
  const std::wstring requestPath = WinHttpRequestPathFromUrl(parts);
  const DWORD headerLength = extraHeaders
      ? static_cast<DWORD>(wcslen(extraHeaders))
      : 0;

  for (const DWORD accessType : kWinHttpAccessTypes) {
    WinHttpHandle session(WinHttpOpen(
        kNativeMediaTverUserAgent, accessType,
        WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0));
    if (!session) continue;
    WinHttpSetTimeouts(session, 8000, 8000, 8000, 8000);
    DWORD protocols = WINHTTP_PROTOCOL_FLAG_HTTP2;
    WinHttpSetOption(
        session, WINHTTP_OPTION_ENABLE_HTTP_PROTOCOL, &protocols, sizeof(protocols));

    WinHttpHandle connection(
        WinHttpConnect(session, hostName.c_str(), parts.nPort, 0));
    if (!connection) continue;
    WinHttpHandle request(WinHttpOpenRequest(
        connection, method, requestPath.c_str(), nullptr,
        L"https://tver.jp/", WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE));
    if (!request) continue;
    DWORD decompression =
        WINHTTP_DECOMPRESSION_FLAG_GZIP | WINHTTP_DECOMPRESSION_FLAG_DEFLATE;
    WinHttpSetOption(
        request, WINHTTP_OPTION_DECOMPRESSION, &decompression, sizeof(decompression));

    void* body = requestBody.empty()
        ? WINHTTP_NO_REQUEST_DATA
        : const_cast<char*>(requestBody.data());
    const DWORD bodyBytes = static_cast<DWORD>(requestBody.size());
    if (!WinHttpSendRequest(
            request, extraHeaders, headerLength, body, bodyBytes, bodyBytes, 0) ||
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
      if (response.size() > kNativeMediaTverMaximumApiBytes ||
          static_cast<size_t>(available) >
              kNativeMediaTverMaximumApiBytes - response.size()) {
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
  throw std::runtime_error("TVer API request failed");
}

winrt::Windows::Data::Json::JsonObject NativeMediaTverParseJson(
    const std::vector<uint8_t>& bytes) {
  if (bytes.empty()) throw std::runtime_error("empty TVer API response");
  const std::string text(
      reinterpret_cast<const char*>(bytes.data()), bytes.size());
  return winrt::Windows::Data::Json::JsonObject::Parse(Utf8ToWide(text));
}

std::vector<std::wstring> NativeMediaTverContentIds(
    const winrt::Windows::Data::Json::JsonObject& root,
    std::wstring_view requiredType) {
  std::vector<std::wstring> ids;
  const auto contents = root.GetNamedObject(L"result").GetNamedArray(L"contents");
  for (const auto& value : contents) {
    try {
      const auto item = value.GetObject();
      if (std::wstring_view(item.GetNamedString(L"type", L"").c_str()) !=
          requiredType) {
        continue;
      }
      const std::wstring id =
          item.GetNamedObject(L"content").GetNamedString(L"id", L"").c_str();
      if (!NativeMediaTverIdIsSafe(id) ||
          std::find(ids.begin(), ids.end(), id) != ids.end()) {
        continue;
      }
      ids.push_back(id);
    } catch (...) {
    }
  }
  return ids;
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
    const auto episodes = root.GetNamedArray(L"episodes");
    for (const auto& value : episodes) {
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
      } catch (...) {
      }
    }
  } catch (...) {
    ids.clear();
  }
  return ids;
}

NativeMediaTverSeriesResolution ResolveNativeMediaTverSeries(
    std::wstring seriesId) noexcept {
  NativeMediaTverSeriesResolution resolution;
  resolution.seriesId = std::move(seriesId);
  try {
    if (!NativeMediaTverIdIsSafe(resolution.seriesId)) return resolution;

    // The cloud collector owns Sakurazaka-wide discovery. If it is unavailable,
    // stale, malformed, or empty, preserve the previous two-series resolver below.
    try {
      constexpr wchar_t kCloudHeaders[] = L"Accept: application/json\r\n";
      const auto cloudFeed = NativeMediaTverParseJson(NativeMediaTverHttpRequest(
          L"GET", kNativeMediaTverCloudFeedUrl, kCloudHeaders));
      resolution.episodeIds = NativeMediaTverCloudFeedEpisodeIds(cloudFeed);
      if (!resolution.episodeIds.empty()) {
        resolution.success = true;
        return resolution;
      }
    } catch (...) {
      resolution.episodeIds.clear();
    }

    constexpr wchar_t kApiHeaders[] =
        L"x-tver-platform-type: web\r\n"
        L"Origin: https://tver.jp\r\n"
        L"Referer: https://tver.jp/\r\n";
    constexpr wchar_t kSessionHeaders[] =
        L"x-tver-platform-type: web\r\n"
        L"Origin: https://tver.jp\r\n"
        L"Referer: https://tver.jp/\r\n"
        L"Content-Type: application/x-www-form-urlencoded;charset=UTF-8\r\n";

    const auto seasons = NativeMediaTverParseJson(NativeMediaTverHttpRequest(
        L"GET",
        L"https://service-api.tver.jp/api/v1/callSeriesSeasons/" +
            resolution.seriesId,
        kApiHeaders));
    const auto seasonIds = NativeMediaTverContentIds(seasons, L"season");
    if (seasonIds.empty()) return resolution;

    const auto session = NativeMediaTverParseJson(NativeMediaTverHttpRequest(
        L"POST",
        L"https://platform-api.tver.jp/v2/api/platform_users/browser/create",
        kSessionHeaders, "device_type=pc"));
    const auto sessionResult = session.GetNamedObject(L"result");
    const std::wstring uid =
        sessionResult.GetNamedString(L"platform_uid", L"").c_str();
    const std::wstring token =
        sessionResult.GetNamedString(L"platform_token", L"").c_str();
    if (uid.empty() || token.empty()) return resolution;
    const std::wstring query =
        L"?platform_uid=" + NativeMediaTverPercentEncode(uid) +
        L"&platform_token=" + NativeMediaTverPercentEncode(token);

    for (const auto& seasonId : seasonIds) {
      const auto episodes = NativeMediaTverParseJson(NativeMediaTverHttpRequest(
          L"GET",
          L"https://platform-api.tver.jp/service/api/v1/callSeasonEpisodes/" +
              seasonId + query,
          kApiHeaders));
      for (const auto& episodeId : NativeMediaTverContentIds(episodes, L"episode")) {
        if (std::find(
                resolution.episodeIds.begin(), resolution.episodeIds.end(),
                episodeId) == resolution.episodeIds.end()) {
          resolution.episodeIds.push_back(episodeId);
        }
      }
    }
    resolution.success = !resolution.episodeIds.empty();
  } catch (...) {
    resolution.success = false;
    resolution.episodeIds.clear();
  }
  return resolution;
}

std::wstring NativeMediaTverQueueBootstrapScript(
    const NativeMediaTverSeriesResolution& resolution) {
  if (!resolution.success || resolution.episodeIds.empty() ||
      !NativeMediaTverIdIsSafe(resolution.seriesId)) {
    return {};
  }
  const std::wstring seriesPath = L"/series/" + resolution.seriesId;
  std::wstring script = L"(()=>{try{const hrefs=[";
  for (size_t index = 0; index < resolution.episodeIds.size(); ++index) {
    const auto& episodeId = resolution.episodeIds[index];
    if (!NativeMediaTverIdIsSafe(episodeId)) return {};
    if (index) script += L",";
    script += L"'https://tver.jp/episodes/" + episodeId + L"'";
  }
  script +=
      L"];sessionStorage.setItem('__homePanelTverSeriesPath','" + seriesPath +
      L"');sessionStorage.setItem('__homePanelTverEpisodeQueue:" + seriesPath +
      L"',JSON.stringify({hrefs,index:0}));return true;}catch(_){return false;}})()";
  return script;
}

void MarkNativeMediaTverNavigationFailed(std::wstring_view seriesId) noexcept {
  auto& state = NativeMediaTverSeriesResolver();
  std::lock_guard lock(state.mutex);
  if (state.seriesId != seriesId) return;
  state.navigationPending = false;
  state.failedAt = GetTickCount64();
}

void NavigateNativeMediaTverResolution(
    ICoreWebView2* webview,
    const std::shared_ptr<std::atomic<bool>>& alive,
    NativeMediaTverSeriesResolution resolution) noexcept {
  if (!webview || !alive || !alive->load(std::memory_order_acquire) ||
      !resolution.success || resolution.episodeIds.empty()) {
    return;
  }
  const std::wstring bootstrap = NativeMediaTverQueueBootstrapScript(resolution);
  if (bootstrap.empty()) return;
  const std::wstring episodeUrl =
      L"https://tver.jp/episodes/" + resolution.episodeIds.front();
  const std::wstring expectedSeriesId = resolution.seriesId;
  ComPtr<ICoreWebView2> view = webview;
  const auto navigate = [view, alive, episodeUrl, expectedSeriesId]() noexcept {
    if (!alive->load(std::memory_order_acquire) || !view) return;
    const auto currentSeriesId = NativeMediaTverSeriesIdFromWebView(view.Get());
    if (!currentSeriesId || *currentSeriesId != expectedSeriesId) return;
    if (FAILED(view->Navigate(episodeUrl.c_str()))) {
      MarkNativeMediaTverNavigationFailed(expectedSeriesId);
    }
  };
  const auto callback = Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
      [navigate](HRESULT, LPCWSTR) -> HRESULT {
        navigate();
        return S_OK;
      });
  if (FAILED(webview->ExecuteScript(bootstrap.c_str(), callback.Get()))) {
    navigate();
  }
}

void PrepareNativeMediaTverSeriesResolution(
    ICoreWebView2* webview, HWND hostWindow,
    const std::shared_ptr<std::atomic<bool>>& alive) noexcept {
  const auto seriesId = NativeMediaTverSeriesIdFromWebView(webview);
  if (!seriesId || !hostWindow || !IsWindow(hostWindow) || !alive) return;

  auto& state = NativeMediaTverSeriesResolver();
  std::optional<NativeMediaTverSeriesResolution> ready;
  uint64_t generation = 0;
  bool startWorker = false;
  {
    std::lock_guard lock(state.mutex);
    if (state.webviewIdentity != webview || state.seriesId != *seriesId) {
      state.webviewIdentity = webview;
      state.seriesId = *seriesId;
      ++state.generation;
      state.inFlight = false;
      state.navigationPending = false;
      state.failedAt = 0;
      state.ready.reset();
    }
    if (state.ready) {
      ready = std::move(state.ready);
      state.ready.reset();
      if (ready->success) state.navigationPending = true;
    }
    const ULONGLONG now = GetTickCount64();
    if (!ready && !state.inFlight && !state.navigationPending &&
        (!state.failedAt || now - state.failedAt >= kNativeMediaTverSeriesRetryMs)) {
      state.inFlight = true;
      generation = state.generation;
      startWorker = true;
    }
  }

  if (ready && ready->success) {
    NavigateNativeMediaTverResolution(webview, alive, std::move(*ready));
    return;
  }
  if (!startWorker) return;

  try {
    const std::wstring requestedSeriesId = *seriesId;
    std::thread([requestedSeriesId, generation, hostWindow, alive] {
      NativeMediaTverComApartment apartment;
      NativeMediaTverSeriesResolution result;
      result.seriesId = requestedSeriesId;
      if (SUCCEEDED(apartment.result)) {
        result = ResolveNativeMediaTverSeries(requestedSeriesId);
      }
      if (!alive->load(std::memory_order_acquire)) return;
      auto& shared = NativeMediaTverSeriesResolver();
      {
        std::lock_guard lock(shared.mutex);
        if (shared.generation != generation ||
            shared.seriesId != requestedSeriesId) {
          return;
        }
        shared.inFlight = false;
        if (!result.success) shared.failedAt = GetTickCount64();
        shared.ready = std::move(result);
      }
      if (IsWindow(hostWindow)) {
        PostMessageW(hostWindow, WM_TIMER, kNativeMediaTverWatchdogTimer, 0);
      }
    }).detach();
  } catch (...) {
    std::lock_guard lock(state.mutex);
    if (state.generation == generation && state.seriesId == *seriesId) {
      state.inFlight = false;
      state.failedAt = GetTickCount64();
    }
  }
}
}  // namespace