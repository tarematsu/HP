

#pragma comment(lib, "version.lib")

#include "app.h"
#include "version.h"

namespace hp {
namespace {
constexpr uint64_t kMaximumComparableUpdateFileBytes = 64ull * 1024ull * 1024ull;

enum class InstalledFileComparison {
  Matches,
  Differs,
  Unavailable,
};

class UpdateBusyGuard final {
 public:
  explicit UpdateBusyGuard(std::atomic<bool>& busy) noexcept : busy_(busy) {}
  ~UpdateBusyGuard() { busy_.store(false, std::memory_order_release); }
  UpdateBusyGuard(const UpdateBusyGuard&) = delete;
  UpdateBusyGuard& operator=(const UpdateBusyGuard&) = delete;

 private:
  std::atomic<bool>& busy_;
};

void PostUpdateResultNoexcept(
    HWND window, UINT messageId, const std::wstring& message) noexcept {
  if (!window || message.empty()) return;
  try {
    auto copy = std::make_unique<wchar_t[]>(message.size() + 1);
    std::copy(message.begin(), message.end(), copy.get());
    copy[message.size()] = L'\0';
    if (PostMessageW(
            window, messageId, 0, reinterpret_cast<LPARAM>(copy.get()))) {
      copy.release();
    }
  } catch (...) {
  }
}

void AppendUnsigned(std::wstring& output, unsigned long value) {
  wchar_t buffer[16]{};
  wchar_t* cursor = std::end(buffer);
  do {
    *--cursor = static_cast<wchar_t>(L'0' + value % 10);
    value /= 10;
  } while (value != 0);
  output.append(cursor, std::end(buffer));
}

fs::path PendingUpdateManifestPath(const fs::path& dataDir) {
  return dataDir /
      (L"pending-update-" + std::to_wstring(GetCurrentProcessId()) + L"-" +
       std::to_wstring(GetTickCount64()) + L".json");
}

std::wstring InstalledHomePanelVersion(const fs::path& executable) {
  DWORD handle = 0;
  const DWORD size = GetFileVersionInfoSizeW(executable.c_str(), &handle);
  if (!size) return {};
  std::vector<BYTE> data(size);
  if (!GetFileVersionInfoW(executable.c_str(), 0, size, data.data())) return {};
  VS_FIXEDFILEINFO* info = nullptr;
  UINT infoSize = 0;
  if (!VerQueryValueW(data.data(), L"\\", reinterpret_cast<void**>(&info), &infoSize) ||
      !info || infoSize < sizeof(VS_FIXEDFILEINFO) || info->dwSignature != 0xfeef04bd) {
    return {};
  }

  std::wstring version;
  version.reserve(24);
  AppendUnsigned(version, HIWORD(info->dwFileVersionMS));
  version.push_back(L'.');
  AppendUnsigned(version, LOWORD(info->dwFileVersionMS));
  version.push_back(L'.');
  AppendUnsigned(version, HIWORD(info->dwFileVersionLS));
  const WORD revision = LOWORD(info->dwFileVersionLS);
  if (revision) {
    version.push_back(L'.');
    AppendUnsigned(version, revision);
  }
  return version;
}

InstalledFileComparison CompareInstalledFile(const fs::path& path,
                                               const UpdateFileSpec& file) noexcept {
  try {
    std::error_code error;
    const bool exists = fs::exists(path, error);
    if (error) return InstalledFileComparison::Unavailable;
    if (!exists) return InstalledFileComparison::Differs;

    const uint64_t size = fs::file_size(path, error);
    if (error) return InstalledFileComparison::Unavailable;
    if (size != file.size) return InstalledFileComparison::Differs;
    if (size == 0 || size > kMaximumComparableUpdateFileBytes) {
      return InstalledFileComparison::Unavailable;
    }

    std::ifstream input(path, std::ios::binary);
    if (!input) return InstalledFileComparison::Unavailable;
    std::vector<uint8_t> bytes(static_cast<size_t>(size));
    input.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
    if (!input || input.gcount() != static_cast<std::streamsize>(bytes.size())) {
      return InstalledFileComparison::Unavailable;
    }
    return Sha256Hex(bytes) == file.sha256
        ? InstalledFileComparison::Matches
        : InstalledFileComparison::Differs;
  } catch (...) {
    return InstalledFileComparison::Unavailable;
  }
}

bool ManifestFilesDiffer(const UpdateManifest& manifest,
                          const fs::path& root) noexcept {
  for (const auto& file : manifest.files) {
    if (CompareInstalledFile(root / file.name, file) == InstalledFileComparison::Differs) {
      return true;
    }
  }
  return false;
}

}  // namespace

void App::CheckForUpdateAsync(bool explicitLocalRequest) {
  // One-argument calls describe the request origin. Startup passes false to
  // silently install only genuinely newer releases; the local update action
  // passes true to preserve status UI and explicit same-version repair.
  CheckForUpdateAsync(true, explicitLocalRequest);
}

void App::CheckForUpdateAsync(bool install, bool allowSameVersionRepair) {
  const bool notify = install && allowSameVersionRepair;
  if (updateBusy_.exchange(true)) {
    if (notify) {
      ShowToast(L"更新確認はすでに実行中です", 4000);
    }
    return;
  }
  if (updateThread_.joinable()) updateThread_.join();
  if (notify) {
    ShowToast(L"署名・ハッシュを確認して更新を準備しています", 15'000);
  }

  try {
    updateThread_ = std::thread([this, install, allowSameVersionRepair, notify] {
      UpdateBusyGuard busyGuard(updateBusy_);
      try {
        std::wstring message;
        try {
          const std::string manifestJson = cloud_->FetchUpdateManifest();
          const UpdateManifest manifest = ParseUpdateManifest(manifestJson);
          const fs::path executable = rootDir_ / L"HomePanel.exe";
          std::wstring currentVersion = InstalledHomePanelVersion(executable);
          if (currentVersion.empty()) currentVersion = kVersion;
          const bool newerVersion = IsVersionNewer(manifest.version, currentVersion);
          const bool sameVersion =
              !newerVersion && !IsVersionNewer(currentVersion, manifest.version);
          const bool replacementBuild =
              sameVersion && allowSameVersionRepair &&
              ManifestFilesDiffer(manifest, rootDir_);
          if (!newerVersion && !replacementBuild) {
            if (notify) {
              message.reserve(currentVersion.size() + 20);
              message.append(L"すでに最新バージョンです (v");
              message.append(currentVersion);
              message.push_back(L')');
            }
          } else if (!install) {
            message.reserve(manifest.version.size() + 24);
            message.append(L"HomePanel ");
            message.append(manifest.version);
            message.append(L" が利用できます");
          } else {
            if (replacementBuild) {
              if (logger_) {
                logger_->Info(
                    L"Applying an explicitly requested repair for the same version and different release files");
              }
            }
            if (LaunchVerifiedUpdater(manifest.version, manifestJson)) {
              if (logger_) {
                try {
                  logger_->Info(
                      L"Verified updater launched for version " + manifest.version +
                      L"; HomePanel remains active until installation is ready");
                } catch (...) {
                  logger_->Info(L"Verified updater launched; HomePanel remains active until installation is ready");
                }
              }
              return;
            }
            message = L"検証済み更新プログラムを起動できませんでした";
          }
        } catch (const std::exception& error) {
          if (logger_) {
            try {
              logger_->Warn(L"Update check failed: " + Utf8ToWide(error.what()));
            } catch (...) {
              logger_->Warn(L"Update check failed while formatting diagnostics");
            }
          }
          if (install) {
            try {
              const std::wstring detail = Utf8ToWide(error.what());
              message.reserve(detail.size() + 10);
              message.append(L"更新確認に失敗: ");
              message.append(detail);
            } catch (...) {
              message.clear();
            }
          }
        } catch (...) {
          if (logger_) logger_->Warn(L"Update check failed with an unknown exception");
          if (install) {
            try {
              message = L"更新確認に失敗しました";
            } catch (...) {
              message.clear();
            }
          }
        }

        PostUpdateResultNoexcept(window_, kUpdateResultMessage, message);
      } catch (...) {
        // std::thread invokes std::terminate when its entry function unwinds.
        // Keep a final boundary outside diagnostics, allocation and PostMessage.
        if (logger_) logger_->Warn(L"Update worker stopped after an internal failure");
      }
    });
  } catch (...) {
    updateBusy_.store(false, std::memory_order_release);
    throw;
  }
}

bool App::LaunchVerifiedUpdater(const std::wstring& version, const std::string& manifestJson) {
  const fs::path installedUpdater = rootDir_ / L"HomePanelUpdater.exe";
  if (!fs::exists(installedUpdater)) {
    logger_->Warn(L"HomePanelUpdater.exe is not installed; one manual package update is required");
    return false;
  }

  const fs::path pending = PendingUpdateManifestPath(dataDir_);
  if (!AtomicWriteText(pending, manifestJson)) return false;

  const fs::path runnerDirectory = dataDir_ / L"update-runner";
  const fs::path runner = runnerDirectory / L"HomePanelUpdater.exe";
  std::error_code ignored;
  fs::create_directories(runnerDirectory, ignored);
  if (ignored || !CopyFileW(installedUpdater.c_str(), runner.c_str(), FALSE)) {
    logger_->Warn(L"Failed to stage the update runner: " + std::to_wstring(GetLastError()));
    ignored.clear();
    fs::remove(pending, ignored);
    return false;
  }

  const std::wstring runnerArgument = QuotePath(runner);
  const std::wstring rootArgument = QuotePath(rootDir_);
  const std::wstring manifestArgument = QuotePath(pending);
  std::wstring command;
  command.reserve(
      runnerArgument.size() + rootArgument.size() + manifestArgument.size() +
      version.size() + 96);
  command.append(runnerArgument);
  command.append(L" --pid ");
  AppendUnsigned(command, GetCurrentProcessId());
  command.append(L" --app-pid ");
  AppendUnsigned(command, GetCurrentProcessId());
  command.append(L" --root ");
  command.append(rootArgument);
  command.append(L" --manifest ");
  command.append(manifestArgument);
  command.append(L" --version ");
  command.append(version);
  command.push_back(L'\0');

  STARTUPINFOW startup{sizeof(startup)};
  PROCESS_INFORMATION process{};
  if (!CreateProcessW(runner.c_str(), command.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW,
                      nullptr, rootDir_.c_str(), &startup, &process)) {
    logger_->Warn(L"CreateProcess for updater failed: " + std::to_wstring(GetLastError()));
    ignored.clear();
    fs::remove(pending, ignored);
    return false;
  }
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  return true;
}

}  // namespace hp
