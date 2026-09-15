#include "web_renderer.h"

namespace hp {
namespace {
template <typename Stamp>
bool ReadPanelSource(const fs::path& jsonPath, const Stamp& current,
                     Stamp& next, std::string& text) {
  std::error_code error;
  const fs::path path = jsonPath.lexically_normal();
  const std::uintmax_t size = fs::file_size(path, error);
  if (error || size == 0 ||
      size > static_cast<std::uintmax_t>(std::numeric_limits<std::streamsize>::max())) {
    return false;
  }
  const fs::file_time_type modifiedAt = fs::last_write_time(path, error);
  if (error) return false;
  next = {path, size, modifiedAt, true};
  text.clear();
  if (current.valid && current.path == path && current.size == size &&
      current.modifiedAt == modifiedAt) return true;

  std::ifstream input(path, std::ios::binary);
  if (!input) return false;
  text.resize(static_cast<size_t>(size));
  input.read(text.data(), static_cast<std::streamsize>(text.size()));
  return input.gcount() == static_cast<std::streamsize>(text.size()) &&
         input.peek() == std::char_traits<char>::eof();
}
}  // namespace

bool Renderer::LoadDashboard(const fs::path& jsonPath, bool* changed) {
  if (changed) *changed = false;
  try {
    DashboardSourceStamp nextStamp;
    std::string text;
    if (!ReadPanelSource(jsonPath, dashboardSourceStamp_, nextStamp, text)) return false;
    if (text.empty()) return true;

    // dashboardUtf8_ is retained as a compatibility field name, but now stores
    // only a small content signature instead of a second persistent copy of
    // dashboard.json. Size is included so differently sized input cannot be
    // treated as equal solely because of the 64-bit hash.
    const auto sourceSize = nextStamp.size;
    const std::string contentSignature =
        std::to_string(sourceSize) + ":" + std::to_string(Fnv1a64(text));
    if (dashboardSourceStamp_.valid && dashboardUtf8_ == contentSignature) {
      dashboardSourceStamp_ = nextStamp;
      return true;
    }

    DashboardSnapshot snapshot;
    const DashboardSnapshot* previous = dashboardSourceStamp_.valid ? &nativeDashboard_ : nullptr;
    if (!ParseDashboardSnapshot(text, snapshot, previous)) return false;
    const bool firstSnapshot = !dashboardSourceStamp_.valid;
    const bool weatherChanged = firstSnapshot ||
        snapshot.revisions.weather != nativeDashboard_.revisions.weather;
    const bool octopusChanged = firstSnapshot ||
        snapshot.revisions.octopus != nativeDashboard_.revisions.octopus;
    const bool energyChanged = octopusChanged;
    const bool contentChanged = weatherChanged || energyChanged;

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
    DashboardSourceStamp nextStamp;
    std::string text;
    if (!ReadPanelSource(jsonPath, switchbotSourceStamp_, nextStamp, text)) return false;
    if (text.empty()) return true;

    const std::string contentSignature =
        std::to_string(nextStamp.size) + ":" + std::to_string(Fnv1a64(text));
    if (switchbotSourceStamp_.valid && switchbotUtf8_ == contentSignature) {
      switchbotSourceStamp_ = nextStamp;
      return true;
    }

    std::vector<std::wstring> devices;
    if (!ParseSwitchBotDevices(text, devices)) return false;
    const bool rowCountChanged =
        (devices.size() > 2) != (nativeDashboard_.switchBotDevices.size() > 2);
    if (devices == nativeDashboard_.switchBotDevices) {
      switchbotUtf8_ = contentSignature;
      switchbotSourceStamp_ = nextStamp;
      return true;
    }

    nativeDashboard_.switchBotDevices = std::move(devices);
    switchbotUtf8_ = contentSignature;
    switchbotSourceStamp_ = nextStamp;
    if (changed) *changed = true;

    if (nativeDashboardVisible_) {
      InvalidatePanelSection(
          nativeMainWindow_,
          rowCountChanged ? PanelSection::Energy : PanelSection::EnergySwitchBot);
    }
    return true;
  } catch (...) {
    return false;
  }
}

}  // namespace hp
