


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

void AppendUnsigned(std::wstring& output, unsigned long value) {
  wchar_t buffer[16]{};
  wchar_t* cursor = std::end(buffer);
  do {
    *--cursor = static_cast<wchar_t>(L'0' + value % 10);
    value /= 10;
  } while (value != 0);
  output.append(cursor, std::end(buffer));
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

void App::CheckForUpdateAsync(bool install) {
  CheckForUpdateAsync(install, install);
}

void App::CheckForUpdateAsync(bool install, bool allowSameVersionRepair) {
  if (updateBusy_.exchange(true)) {
    if (install) {
      ShowToast(L"更新確認はすでに実行中です", 4000);
    }
    return;
  }
  if (updateThread_.joinable()) updateThread_.join();
  if (install) {
    ShowToast(L"署名・ハッシュを確認して更新を準備しています", 15'000);
  }

  updateThread_ = std::thread([this, install, allowSameVersionRepair] {
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
        if (install) {
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
          logger_->Info(L"Applying an explicitly requested same-version repair");
        }
        if (LaunchVerifiedUpdater(manifest.version, manifestJson)) {
          logger_->Info(
              L"Verified updater launched for version " + manifest.version +
              L"; HomePanel remains active until installation is ready");
          updateBusy_ = false;
          return;
        }
        message = L"検証済み更新プログラムを起動できませんでした";
      }
    } catch (const std::exception& error) {
      const std::wstring detail = Utf8ToWide(error.what());
      logger_->Warn(L"Update check failed: " + detail);
      if (install) {
        message.reserve(detail.size() + 10);
        message.append(L"更新確認に失敗: ");
        message.append(detail);
      }
    }

    if (!message.empty()) {
      auto copy = std::make_unique<wchar_t[]>(message.size() + 1);
      std::copy(message.begin(), message.end(), copy.get());
      copy[message.size()] = L'\0';
      if (PostMessageW(window_, kUpdateResultMessage, 0, reinterpret_cast<LPARAM>(copy.get()))) {
        copy.release();
      }
    }
    updateBusy_ = false;
  });
}

bool App::LaunchVerifiedUpdater(const std::wstring& version, const std::string& manifestJson) {
  const fs::path installedUpdater = rootDir_ / L"HomePanelUpdater.exe";
  if (!fs::exists(installedUpdater)) {
    logger_->Warn(L"HomePanelUpdater.exe is not installed; one manual package update is required");
    return false;
  }

  const fs::path pending = dataDir_ / L"pending-update.json";
  if (!AtomicWriteText(pending, manifestJson)) return false;

  const fs::path runnerDirectory = dataDir_ / L"update-runner";
  const fs::path runner = runnerDirectory / L"HomePanelUpdater.exe";
  std::error_code ignored;
  fs::create_directories(runnerDirectory, ignored);
  if (ignored || !CopyFileW(installedUpdater.c_str(), runner.c_str(), FALSE)) {
    logger_->Warn(L"Failed to stage the update runner: " + std::to_wstring(GetLastError()));
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
    return false;
  }
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  return true;
}

}  // namespace hp
