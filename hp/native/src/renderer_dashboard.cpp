#include "web_renderer.h"

namespace hp {
namespace {
size_t PlugRows(const DashboardSnapshot& value) {
  return std::min<size_t>(4, value.switchBotDevices.size()) > 2 ? 2 : 1;
}
}

bool Renderer::LoadDashboard(const fs::path& jsonPath, bool* changed) {
  if (changed) *changed = false;
  try {
    std::error_code error;
    const fs::path normalizedPath = jsonPath.lexically_normal();
    const std::uintmax_t sourceSize = fs::file_size(normalizedPath, error);
    if (error || sourceSize == 0 ||
        sourceSize > static_cast<std::uintmax_t>(std::numeric_limits<std::streamsize>::max())) {
      return false;
    }
    const fs::file_time_type modifiedAt = fs::last_write_time(normalizedPath, error);
    if (error) return false;

    if (dashboardSourceStamp_.valid &&
        dashboardSourceStamp_.path == normalizedPath &&
        dashboardSourceStamp_.size == sourceSize &&
        dashboardSourceStamp_.modifiedAt == modifiedAt) {
      return true;
    }

    std::ifstream input(normalizedPath, std::ios::binary);
    if (!input) return false;
    std::string text(static_cast<size_t>(sourceSize), '\0');
    input.read(text.data(), static_cast<std::streamsize>(text.size()));
    if (input.gcount() != static_cast<std::streamsize>(text.size()) ||
        input.peek() != std::char_traits<char>::eof()) {
      return false;
    }

    const DashboardSourceStamp nextStamp{
        normalizedPath, sourceSize, modifiedAt, true};
    // dashboardUtf8_ is retained as a compatibility field name, but now stores
    // only a small content signature instead of a second persistent copy of
    // dashboard.json. Size is included so differently sized input cannot be
    // treated as equal solely because of the 64-bit hash.
    const std::string contentSignature =
        std::to_string(sourceSize) + ":" + std::to_string(Fnv1a64(text));
    if (dashboardSourceStamp_.valid && dashboardUtf8_ == contentSignature) {
      dashboardSourceStamp_ = nextStamp;
      return true;
    }

    DashboardSnapshot snapshot;
    const DashboardSnapshot* previous = nativeDashboard_.loaded ? &nativeDashboard_ : nullptr;
    if (!ParseDashboardSnapshot(text, snapshot, nullptr, previous)) return false;
    const bool firstSnapshot = !nativeDashboard_.loaded;
    const bool weatherChanged = firstSnapshot ||
        snapshot.revisions.weather != nativeDashboard_.revisions.weather;
    const bool octopusChanged = firstSnapshot ||
        snapshot.revisions.octopus != nativeDashboard_.revisions.octopus;
    const bool contentChanged = weatherChanged || octopusChanged;

    nativeDashboard_ = std::move(snapshot);
    dashboardUtf8_ = contentSignature;
    dashboardSourceStamp_ = nextStamp;
    if (changed) *changed = contentChanged;

    // Dashboard ownership ends here: the loader knows exactly which source
    // changed, so invalidate that region directly instead of publishing a
    // second set of renderer revisions for a later comparison pass.
    if (nativeDashboardVisible_) {
      if (weatherChanged) {
        InvalidatePanelSection(nativeSideWindow_, PanelSection::Weather);
      }
      if (octopusChanged) {
        InvalidatePanelSection(nativeMainWindow_, PanelSection::Energy);
      }
    }
    return true;
  } catch (...) {
    return false;
  }
}

bool Renderer::LoadSwitchBot(const fs::path& jsonPath, bool* changed) {
  if (changed) *changed = false;
  try {
    std::error_code error;
    const fs::path normalizedPath = jsonPath.lexically_normal();
    const std::uintmax_t sourceSize = fs::file_size(normalizedPath, error);
    if (error || sourceSize == 0 ||
        sourceSize > static_cast<std::uintmax_t>(std::numeric_limits<std::streamsize>::max())) {
      return false;
    }
    const fs::file_time_type modifiedAt = fs::last_write_time(normalizedPath, error);
    if (error) return false;

    if (switchbotSourceStamp_.valid &&
        switchbotSourceStamp_.path == normalizedPath &&
        switchbotSourceStamp_.size == sourceSize &&
        switchbotSourceStamp_.modifiedAt == modifiedAt) {
      return true;
    }

    std::ifstream input(normalizedPath, std::ios::binary);
    if (!input) return false;
    std::string text(static_cast<size_t>(sourceSize), '\0');
    input.read(text.data(), static_cast<std::streamsize>(text.size()));
    if (input.gcount() != static_cast<std::streamsize>(text.size()) ||
        input.peek() != std::char_traits<char>::eof()) {
      return false;
    }

    const DashboardSourceStamp nextStamp{
        normalizedPath, sourceSize, modifiedAt, true};
    const std::string contentSignature =
        std::to_string(sourceSize) + ":" + std::to_string(Fnv1a64(text));
    if (switchbotSourceStamp_.valid && switchbotUtf8_ == contentSignature) {
      switchbotSourceStamp_ = nextStamp;
      return true;
    }

    std::vector<SwitchBotDeviceData> devices;
    if (!ParseSwitchBotDevices(text, devices, nullptr)) return false;
    const size_t previousRows = PlugRows(nativeDashboard_);
    const bool devicesChanged = devices != nativeDashboard_.switchBotDevices;
    if (!devicesChanged) {
      switchbotUtf8_ = contentSignature;
      switchbotSourceStamp_ = nextStamp;
      return true;
    }

    nativeDashboard_.switchBotDevices = std::move(devices);
    nativeDashboard_.revisions.switchbot = Fnv1a64(text);
    const size_t nextRows = PlugRows(nativeDashboard_);
    switchbotUtf8_ = contentSignature;
    switchbotSourceStamp_ = nextStamp;
    if (changed) *changed = true;

    if (nativeDashboardVisible_) {
      InvalidatePanelSection(
          nativeMainWindow_,
          previousRows == nextRows ? PanelSection::EnergySwitchBot : PanelSection::Energy);
    }
    return true;
  } catch (...) {
    return false;
  }
}

}  // namespace hp
