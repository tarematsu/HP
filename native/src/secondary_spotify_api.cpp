#include "secondary_sh.h"
#include "cloud_client.h"
#include <shellapi.h>
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {
int64_t nextPollAt = 0;

void Rearm(SecondaryStationheadPlayer*, int64_t = 30'000) {}

bool Connected(const std::vector<uint8_t>& bytes) {
  try {
    const std::string body(bytes.begin(), bytes.end());
    return winrt::Windows::Data::Json::JsonObject::Parse(Utf8ToWide(body))
        .GetNamedBoolean(L"connected", false);
  } catch (...) {
    return false;
  }
}

bool Connected(const std::string& body) {
  return Connected(std::vector<uint8_t>(body.begin(), body.end()));
}

bool IsTrustedSpotifyAuthorizationUrl(const std::wstring& url) {
  constexpr std::wstring_view prefix =
      L"https://accounts.spotify.com/authorize";
  if (url.size() < prefix.size() ||
      url.compare(0, prefix.size(), prefix) != 0) {
    return false;
  }
  return url.size() == prefix.size() || url[prefix.size()] == L'?' ||
         url[prefix.size()] == L'#';
}

std::wstring ExpandPath(const wchar_t* value) {
  const DWORD required = ExpandEnvironmentStringsW(value, nullptr, 0);
  if (!required) return {};
  std::wstring expanded(required, L'\0');
  const DWORD written =
      ExpandEnvironmentStringsW(value, expanded.data(), required);
  if (!written || written > required) return {};
  expanded.resize(wcsnlen(expanded.c_str(), expanded.size()));
  return expanded;
}

bool LaunchExecutable(const std::wstring& executable,
                      const std::wstring& arguments) {
  if (executable.empty() ||
      GetFileAttributesW(executable.c_str()) == INVALID_FILE_ATTRIBUTES) {
    return false;
  }
  std::wstring command = L"\"" + executable + L"\" " + arguments;
  std::vector<wchar_t> mutableCommand(command.begin(), command.end());
  mutableCommand.push_back(L'\0');
  STARTUPINFOW startup{sizeof(startup)};
  PROCESS_INFORMATION process{};
  if (!CreateProcessW(executable.c_str(), mutableCommand.data(), nullptr,
                      nullptr, FALSE, 0, nullptr, nullptr, &startup,
                      &process)) {
    return false;
  }
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  return true;
}

bool LaunchDedicatedSpotifyChrome(const std::wstring& url,
                                  const fs::path& profileDirectory) {
  if (!IsTrustedSpotifyAuthorizationUrl(url)) return false;
  std::error_code ignored;
  fs::create_directories(profileDirectory, ignored);
  const std::wstring arguments =
      L"--new-window --no-first-run --disable-background-mode "
      L"--user-data-dir=\"" + profileDirectory.wstring() + L"\" \"" +
      url + L"\"";
  for (const wchar_t* candidate : {
           L"%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe",
           L"%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe",
           L"%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe"}) {
    if (LaunchExecutable(ExpandPath(candidate), arguments)) return true;
  }

  for (const wchar_t* candidate : {
           L"%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe",
           L"%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"}) {
    if (LaunchExecutable(ExpandPath(candidate), arguments)) return true;
  }

  SHELLEXECUTEINFOW launch{sizeof(launch)};
  launch.fMask = SEE_MASK_FLAG_NO_UI | SEE_MASK_NOASYNC;
  launch.lpVerb = L"open";
  launch.lpFile = url.c_str();
  launch.nShow = SW_SHOWNORMAL;
  return ShellExecuteExW(&launch) != FALSE;
}

struct BootstrapWebResult {
  DWORD status = 0;
  std::string body;
};

std::string BootstrapWinHttpErrorText(const char* action) {
  return std::string(action) + " failed (" + std::to_string(GetLastError()) + ")";
}

BootstrapWebResult BootstrapWebRequest(
    const std::wstring& method, const std::wstring& url,
    const std::wstring& bearer, const std::string& body = {}) {
  URL_COMPONENTS parts{sizeof(parts)};
  wchar_t host[256]{};
  wchar_t path[4096]{};
  parts.lpszHostName = host;
  parts.dwHostNameLength = _countof(host);
  parts.lpszUrlPath = path;
  parts.dwUrlPathLength = _countof(path);
  parts.dwSchemeLength = 1;
  parts.dwExtraInfoLength = 1;
  if (!WinHttpCrackUrl(url.c_str(), 0, 0, &parts)) {
    throw std::runtime_error("invalid Spotify bootstrap URL");
  }
  std::wstring requestPath(path, parts.dwUrlPathLength);
  if (parts.lpszExtraInfo && parts.dwExtraInfoLength) {
    requestPath.append(parts.lpszExtraInfo, parts.dwExtraInfoLength);
  }

  // Tablets frequently sit on networks where WPAD/PAC autodetection never
  // resolves (no proxy service, or a proxy the automatic scan can't see),
  // which used to make every bootstrap request fail outright. Mirror the
  // AUTOMATIC_PROXY -> NO_PROXY fallback already used for cloud sync and
  // Spotify playback polling so bootstrap status checks recover the same way.
  for (DWORD accessType : {WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_ACCESS_TYPE_NO_PROXY}) {
    HINTERNET session = WinHttpOpen(
        L"HomePanel-Spotify-Bootstrap/2.0", accessType,
        WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!session) {
      if (accessType == WINHTTP_ACCESS_TYPE_NO_PROXY) {
        throw std::runtime_error(BootstrapWinHttpErrorText("bootstrap WinHttpOpen"));
      }
      continue;
    }
    HINTERNET connection = WinHttpConnect(
        session, std::wstring(host, parts.dwHostNameLength).c_str(),
        parts.nPort, 0);
    if (!connection) {
      WinHttpCloseHandle(session);
      if (accessType == WINHTTP_ACCESS_TYPE_NO_PROXY) {
        throw std::runtime_error(BootstrapWinHttpErrorText("bootstrap WinHttpConnect"));
      }
      continue;
    }
    HINTERNET request = WinHttpOpenRequest(
        connection, method.c_str(), requestPath.c_str(), nullptr,
        WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
        parts.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0);
    if (!request) {
      WinHttpCloseHandle(connection);
      WinHttpCloseHandle(session);
      if (accessType == WINHTTP_ACCESS_TYPE_NO_PROXY) {
        throw std::runtime_error(BootstrapWinHttpErrorText("bootstrap request creation"));
      }
      continue;
    }
    WinHttpSetTimeouts(request, 8000, 8000, 8000, 8000);
    std::wstring headers = L"Accept: application/json\r\n";
    if (!bearer.empty()) {
      headers += L"Authorization: Bearer " + bearer + L"\r\n";
    }
    if (!body.empty()) {
      headers += L"Content-Type: application/json\r\n";
    }
    const BOOL sent = WinHttpSendRequest(
        request, headers.c_str(), static_cast<DWORD>(headers.size()),
        body.empty() ? WINHTTP_NO_REQUEST_DATA
                     : const_cast<char*>(body.data()),
        static_cast<DWORD>(body.size()), static_cast<DWORD>(body.size()), 0);
    if (!sent || !WinHttpReceiveResponse(request, nullptr)) {
      const std::string detail = BootstrapWinHttpErrorText("bootstrap request");
      WinHttpCloseHandle(request);
      WinHttpCloseHandle(connection);
      WinHttpCloseHandle(session);
      if (accessType == WINHTTP_ACCESS_TYPE_NO_PROXY) throw std::runtime_error(detail);
      continue;
    }

    BootstrapWebResult result;
    DWORD statusSize = sizeof(result.status);
    WinHttpQueryHeaders(
        request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
        WINHTTP_HEADER_NAME_BY_INDEX, &result.status, &statusSize,
        WINHTTP_NO_HEADER_INDEX);
    bool ok = true;
    std::string failure;
    for (;;) {
      DWORD available = 0;
      if (!WinHttpQueryDataAvailable(request, &available)) {
        ok = false;
        failure = BootstrapWinHttpErrorText("bootstrap response query");
        break;
      }
      if (!available) break;
      const size_t offset = result.body.size();
      result.body.resize(offset + available);
      DWORD read = 0;
      if (!WinHttpReadData(request, result.body.data() + offset,
                           available, &read)) {
        ok = false;
        failure = BootstrapWinHttpErrorText("bootstrap response read");
        break;
      }
      result.body.resize(offset + read);
      if (!read) break;
    }
    WinHttpCloseHandle(request);
    WinHttpCloseHandle(connection);
    WinHttpCloseHandle(session);
    if (ok) return result;
    if (accessType == WINHTTP_ACCESS_TYPE_NO_PROXY) throw std::runtime_error(failure);
  }
  throw std::runtime_error("bootstrap request failed");
}

void WriteBootstrapState(const fs::path& dataDirectory,
                         const std::wstring& detail) {
  const std::string text =
      std::to_string(UnixMillis()) + "\n" + WideToUtf8(detail) + "\n";
  AtomicWriteText(dataDirectory / L"spotify-auth-bootstrap.log", text);
}

void SleepBootstrapRetry() {
  for (int index = 0; index < 20; ++index) Sleep(500);
}
}  // namespace

bool CloudClient::SpotifyAuthorizationRequired() {
  if (deviceToken_.empty() || config_.cloudflareBaseUrl.empty()) return true;
  try {
    const auto response =
        Request(L"GET", L"/v1/spotify/status", deviceToken_);
    if (response.status == 200) return !Connected(response.body);
    log_.Warn(L"Spotify cloud status was not confirmed; HTTP " +
              std::to_wstring(response.status));
    return true;
  } catch (const std::exception& error) {
    log_.Warn(L"Spotify cloud status check failed: " +
              Utf8ToWide(error.what()));
    return true;
  }
}

void CloudClient::StartSpotifyAuthorizationBootstrap() {
  static std::atomic<bool> started{false};
  if (started.exchange(true, std::memory_order_acq_rel)) return;

  std::wstring baseUrl = config_.cloudflareBaseUrl;
  while (!baseUrl.empty() && baseUrl.back() == L'/') baseUrl.pop_back();
  const std::wstring deviceToken = deviceToken_;
  const fs::path dataDirectory = dataDir_;
  std::thread([baseUrl = std::move(baseUrl), deviceToken,
               dataDirectory]() {
    if (baseUrl.empty()) {
      WriteBootstrapState(dataDirectory,
                          L"Spotify auth bootstrap failed: cloud URL missing");
      return;
    }
    if (deviceToken.empty()) {
      WriteBootstrapState(dataDirectory,
                          L"Spotify auth bootstrap failed: device token missing");
      return;
    }

    const std::wstring statusUrl = baseUrl + L"/v1/spotify/status";
    const std::wstring authorizeUrl = baseUrl + L"/v1/spotify/authorize";
    for (int attempt = 1; attempt <= 18; ++attempt) {
      try {
        const BootstrapWebResult status = BootstrapWebRequest(
            L"GET", statusUrl, deviceToken);
        if (status.status == 200 && Connected(status.body)) {
          WriteBootstrapState(dataDirectory,
                              L"Spotify cloud authorization already connected");
          return;
        }
        if (status.status == 401 || status.status == 403) {
          WriteBootstrapState(
              dataDirectory,
              L"Spotify auth bootstrap failed: device token rejected, HTTP " +
                  std::to_wstring(status.status));
          return;
        }
        if (status.status != 200) {
          WriteBootstrapState(
              dataDirectory,
              L"Spotify status unavailable, retry " +
                  std::to_wstring(attempt) + L", HTTP " +
                  std::to_wstring(status.status));
          SleepBootstrapRetry();
          continue;
        }

        const BootstrapWebResult authorization = BootstrapWebRequest(
            L"POST", authorizeUrl, deviceToken, "{}");
        if (authorization.status != 200) {
          WriteBootstrapState(
              dataDirectory,
              L"Spotify authorization URL unavailable, retry " +
                  std::to_wstring(attempt) + L", HTTP " +
                  std::to_wstring(authorization.status));
          SleepBootstrapRetry();
          continue;
        }
        const auto payload =
            winrt::Windows::Data::Json::JsonObject::Parse(
                Utf8ToWide(authorization.body));
        const std::wstring url =
            payload.GetNamedString(L"authorizationUrl", L"").c_str();
        if (!IsTrustedSpotifyAuthorizationUrl(url)) {
          WriteBootstrapState(
              dataDirectory,
              L"Spotify auth bootstrap rejected an invalid authorization URL");
          return;
        }
        if (!LaunchDedicatedSpotifyChrome(
                url, dataDirectory / L"spotify-auth-chrome")) {
          WriteBootstrapState(
              dataDirectory,
              L"Spotify auth bootstrap could not launch Chrome or fallback browser");
          return;
        }
        WriteBootstrapState(
            dataDirectory,
            L"Spotify authorization opened in dedicated Chrome profile");
        return;
      } catch (const std::exception& error) {
        WriteBootstrapState(
            dataDirectory,
            L"Spotify auth bootstrap retry " + std::to_wstring(attempt) +
                L": " + Utf8ToWide(error.what()));
      } catch (...) {
        WriteBootstrapState(
            dataDirectory,
            L"Spotify auth bootstrap retry failed with an unknown error");
      }
      SleepBootstrapRetry();
    }
    WriteBootstrapState(
        dataDirectory,
        L"Spotify auth bootstrap exhausted all retries without opening Chrome");
  }).detach();
}

void MaybeStartSpotifyApiAuthorization(
    SecondaryStationheadPlayer*) noexcept {
  // Spotify cloud OAuth is started directly by CloudClient during application
  // startup. It must never depend on either Stationhead WebView lifecycle.
}

void SecondaryStationheadPlayer::StopSpotifyApiAuthorizationWorker() noexcept {
  if (apiAuthThread_.joinable()) apiAuthThread_.join();
  apiAuthExchangePending_ = false;
  apiAuthExchangeDone_ = false;
}

void SecondaryStationheadPlayer::PollSpotifyApiAuthorization() {
  if (!apiAuthorization_ || shuttingDown_) return;
  const int64_t now = UnixMillis();
  if (now < nextPollAt) return;
  nextPollAt = now + 3'000;
  auto* cloud = CloudClient::Current();
  if (!cloud || cloud->SpotifyAuthorizationRequired()) return;

  ResetSpotifyApiAuthorization(
      L"Spotify cloud authorization completed", false);
  cloud->RefreshSpotifyNow();
  RestoreSecondaryAfterSpotifyApiAuthorization();
  Rearm(this);
}

void SecondaryStationheadPlayer::
    RestoreSecondaryAfterSpotifyApiAuthorization() {
  if (!shuttingDown_) {
    ShowInteractive(loginRequired_.load(std::memory_order_acquire));
  }
}

void SecondaryStationheadPlayer::StartSpotifyApiTokenExchange(
    const std::wstring&) {}

void SecondaryStationheadPlayer::ResetSpotifyApiAuthorization(
    const std::wstring& detail, bool allowAutomaticRetry) {
  apiAuthorization_ = false;
  spotifyAuthorization_ = false;
  apiAuthStartedAt_ = 0;
  {
    std::lock_guard lock(mutex_);
    status_.apiAuthorization = false;
    status_.spotifyAuthorization = false;
    status_.navigating = false;
    if (!detail.empty()) status_.detail = detail;
  }
  const bool interrupted =
      detail.find(L"timed out") != std::wstring::npos ||
      detail.find(L"failed") != std::wstring::npos ||
      detail.find(L"cancel") != std::wstring::npos;
  if (allowAutomaticRetry || interrupted) Rearm(this);
}

bool SecondaryStationheadPlayer::OpenSpotifyApiAuthorization(
    const std::wstring& url) {
  if (url.empty() || shuttingDown_) return false;
  if (!IsTrustedSpotifyAuthorizationUrl(url)) {
    SetStatus(L"Spotify authorization URL was rejected");
    log_.Warn(L"Cloud returned an unexpected Spotify authorization URL");
    return false;
  }
  if (!LaunchDedicatedSpotifyChrome(
          url, userDataFolder_.parent_path() / L"spotify-auth-chrome")) {
    SetStatus(L"Spotify authorization browser could not be opened");
    log_.Warn(L"Spotify authorization browser launch failed");
    return false;
  }
  apiAuthorization_ = true;
  apiAuthStartedAt_ = UnixMillis();
  nextPollAt = apiAuthStartedAt_ + 1'000;
  {
    std::lock_guard lock(mutex_);
    status_.apiAuthorization = true;
    status_.navigating = false;
    status_.detail =
        L"Spotify authorization opened in dedicated Chrome";
  }
  log_.Info(L"Spotify API authorization opened in dedicated Chrome");
  ShowInteractive(false);
  return true;
}

}  // namespace hp
