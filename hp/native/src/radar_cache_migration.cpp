#include "common.h"

namespace hp {
namespace {

bool IsSinglePrecomposedRadarJson(const fs::path& path) noexcept {
  try {
    std::ifstream input(path, std::ios::binary);
    if (!input) return false;
    const std::string text((std::istreambuf_iterator<char>(input)), {});
    if (text.empty()) return false;

    // Cloud localization rewrites the representative URL to data.homepanel,
    // but keeps the representative path. These markers intentionally describe
    // only the single precomposed representative-frame contract and reject
    // every old multi-frame payload without depending on the panel count.
    const bool precomposed =
        text.find("\"precomposed\":true") != std::string::npos;
    const bool representative =
        text.find("/v1/radar/frame/representative/latest.png") !=
        std::string::npos;
    const bool representativeProvider =
        text.find("one cloud-composited representative frame") !=
        std::string::npos;
    const bool legacyAnimation =
        text.find("\"frameIntervalMs\"") != std::string::npos;
    return precomposed && representative && representativeProvider &&
           !legacyAnimation;
  } catch (...) {
    return false;
  }
}

void RemoveLegacyRadarCacheBeforeStartup() noexcept {
  try {
    wchar_t executable[MAX_PATH * 4]{};
    if (GetModuleFileNameW(nullptr, executable, _countof(executable)) == 0) {
      return;
    }
    const fs::path dataDir = fs::path(executable).parent_path() / L"data";
    const fs::path radarJson = dataDir / L"radar.json";
    std::error_code error;
    if (!fs::exists(radarJson, error) || IsSinglePrecomposedRadarJson(radarJson)) {
      return;
    }

    // Removing radar.json makes CloudClient request radarVersion=-1 on its first
    // sync. Remove the renderer's old BMP/signature as well so an animated frame
    // can never flash while the fresh representative PNG is being downloaded.
    fs::remove(radarJson, error);
    error.clear();
    fs::remove(dataDir / L"radar-frame.bmp", error);
    error.clear();
    fs::remove(dataDir / L"radar-frame.signature", error);
  } catch (...) {
  }
}

struct RadarCacheContractMigration final {
  RadarCacheContractMigration() noexcept { RemoveLegacyRadarCacheBeforeStartup(); }
};

// This translation unit is linked only into HomePanel, so the migration runs
// before App/CloudClient/Renderer construction and cannot race the sync thread.
const RadarCacheContractMigration gRadarCacheContractMigration;

}  // namespace
}  // namespace hp
