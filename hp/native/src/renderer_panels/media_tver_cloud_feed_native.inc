// Minimal native TVer cloud-feed client shared by queue refresh workers.
// No series-page discovery or TVer platform API fallback lives here: the cloud
// collector is the single source of episode selection for native playback.
namespace {
constexpr size_t kNativeMediaTverMaximumFeedBytes = 2U * 1024U * 1024U;
constexpr ULONGLONG kNativeMediaTverFeedSuccessTtlMs = 5ULL * 1000ULL;
constexpr ULONGLONG kNativeMediaTverFeedFailureBackoffMs = 15ULL * 1000ULL;
constexpr wchar_t kNativeMediaTverCloudFeedUrl[] =
    L"https://homepanel-cloud.tarematsu.workers.dev/v1/native/tver-feed";
constexpr wchar_t kNativeMediaTverUserAgent[] =
    L"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    L"(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
constexpr wchar_t kNativeMediaTverHeaders[] =
    L"Accept: application/json\r\nReferer: https://tver.jp/\r\n";

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
  const hp::CoordinatedNetworkResult coordinated =
      hp::NetworkRequestCoordinator::Run(
          L"control|native-tver-feed",
          kNativeMediaTverFeedSuccessTtlMs,
          kNativeMediaTverFeedFailureBackoffMs,
          [] {
            hp::CoordinatedNetworkResult result;
            result.ok = hp::WinHttpDownload(
                kNativeMediaTverCloudFeedUrl, kNativeMediaTverMaximumFeedBytes,
                &result.body, nullptr, &result.error,
                kNativeMediaTverUserAgent, kNativeMediaTverHeaders);
            return result;
          });

  if (coordinated.ok && !coordinated.body.empty()) return coordinated.body;
  const std::string message = WideToUtf8(
      coordinated.error.empty()
          ? std::wstring(L"TVer cloud feed request failed")
          : coordinated.error);
  throw std::runtime_error(
      message.empty() ? "TVer cloud feed request failed" : message);
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
