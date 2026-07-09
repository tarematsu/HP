#include "common.h"
#include "version.h"

namespace {
std::string ReadResource(int id) {
  HMODULE module = GetModuleHandleW(nullptr);
  HRSRC resource = FindResourceW(module, MAKEINTRESOURCEW(id), RT_RCDATA);
  if (!resource) return {};
  HGLOBAL loaded = ::LoadResource(module, resource);
  const char* bytes = loaded ? static_cast<const char*>(LockResource(loaded)) : nullptr;
  const DWORD size = SizeofResource(module, resource);
  if (!bytes || !size) return {};
  return std::string(bytes, bytes + size);
}

bool FileMatches(const hp::fs::path& path, const std::string& content) {
  std::error_code error;
  if (!hp::fs::is_regular_file(path, error) || hp::fs::file_size(path, error) != content.size()) return false;
  std::ifstream input(path, std::ios::binary);
  if (!input) return false;
  return std::equal(std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>(), content.begin(), content.end());
}

bool NonEmptyFile(const hp::fs::path& path) {
  std::error_code error;
  return hp::fs::is_regular_file(path, error) && hp::fs::file_size(path, error) > 0;
}

bool WriteContent(const hp::fs::path& path, const std::string& content) {
  if (content.empty()) return false;
  if (FileMatches(path, content)) return true;
  return hp::AtomicWriteBytes(path, content.data(), static_cast<DWORD>(content.size()));
}

struct RuntimeAsset {
  int id;
  const wchar_t* name;
};

constexpr RuntimeAsset kRuntimeAssets[] = {
    {110, L"radar-satellite.png"},
    {112, L"radar-map.png"},
};

std::string ExecutableStamp(const hp::fs::path& executable) {
  std::error_code error;
  const auto size = hp::fs::file_size(executable, error);
  std::ostringstream stamp;
  stamp << hp::WideToUtf8(hp::kVersion) << "|native-assets-v1";
  if (!error) stamp << '|' << size;
  return stamp.str();
}

bool RuntimeAssetsReady(const hp::fs::path& folder, const std::string& stamp) {
  if (!FileMatches(folder / L"native-assets.signature", stamp)) return false;
  for (const RuntimeAsset& asset : kRuntimeAssets) {
    if (!NonEmptyFile(folder / asset.name)) return false;
  }
  return true;
}

void RemoveObsoleteDashboardFiles(const hp::fs::path& folder) {
  static constexpr const wchar_t* kFiles[] = {
      L"index.html",
      L"styles.css",
      L"app.js",
      L"texts.json",
      L"air-history.css",
      L"air-history.js",
      L"homepanel-core.js",
      L"homepanel-clock.js",
      L"homepanel-news.js",
      L"homepanel-weather.js",
      L"homepanel-energy.js",
      L"homepanel-switchbot.js",
      L"homepanel-air.js",
      L"homepanel-radar.js",
      L"homepanel-runtime.js",
      L"spotify-panel-runtime.js",
      L"playback-shared.js",
      L"wallpaper.css",
      L"wallpaper-homepanel.png",
      L"wallpaper-homepanel.signature",
      L"ui-bundle.signature",
      L"ui-runtime-final.signature",
      L"ui-styles.signature",
      L"stationhead-audio-controls.js",
      L"stationhead-playback.js",
      L"radar-direct.js",
      L"radar-base.png",
      L"performance.css",
      L"ui-overrides.css",
      L"canvas-transparency.js",
      L"runtime-performance.js",
      L"radar-monochrome.js",
  };
  std::error_code error;
  for (const wchar_t* name : kFiles) {
    hp::fs::remove(folder / name, error);
    error.clear();
  }
  hp::fs::remove_all(folder / L"vendor", error);
}

struct RuntimeAssetInstaller {
  RuntimeAssetInstaller() {
    wchar_t executableRaw[MAX_PATH * 4]{};
    if (!GetModuleFileNameW(nullptr, executableRaw, _countof(executableRaw))) return;
    const hp::fs::path executable(executableRaw);
    const hp::fs::path folder = executable.parent_path() / L"ui";
    std::error_code error;
    hp::fs::create_directories(folder, error);

    const std::string signature = ExecutableStamp(executable);
    if (!RuntimeAssetsReady(folder, signature)) {
      bool installed = true;
      for (const RuntimeAsset& asset : kRuntimeAssets) {
        installed = WriteContent(folder / asset.name, ReadResource(asset.id)) && installed;
      }
      if (installed) WriteContent(folder / L"native-assets.signature", signature);
    }
    RemoveObsoleteDashboardFiles(folder);
  }
};

RuntimeAssetInstaller installer;
}  // namespace
