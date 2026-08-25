#include "app.h"
#include "stationhead_native_stats.h"

namespace hp {

// Stationhead is intentionally not part of the active HomePanel runtime.
// These inert definitions only satisfy dormant compatibility types that remain
// in RenderState/App headers. They never create a WebView, child HWND, network
// session, audio route, or authentication surface.

StationheadPlayer::~StationheadPlayer() = default;

StationheadHandleBase::operator bool() const noexcept {
  return false;
}

AppStationheadHandle::AppStationheadHandle() = default;
AppStationheadHandle::~AppStationheadHandle() = default;
AppSecondaryStationheadHandle::AppSecondaryStationheadHandle() = default;
AppSecondaryStationheadHandle::~AppSecondaryStationheadHandle() = default;

void App::EnrichRenderStationheadState(
    StationheadStatus& state,
    StationheadStatus* secondaryStatus,
    const StationheadConfig& config) {
  (void)state;
  (void)secondaryStatus;
  (void)config;
}

void App::ToggleStationheadAudio() {}
void App::MuteStationheadAudio() {}
void App::NotifyStationheadPlaybackFallbackStarted() {}

void App::LoadStationheadPlayHistory() {}

bool App::SaveStationheadPlayHistory() const {
  return true;
}

void App::UpdateStationheadPlayHistory(const StationheadStatus& status) {
  (void)status;
}

bool PublishStationheadNativeStatsMessage(std::wstring_view messageJson) {
  (void)messageJson;
  return false;
}

StationheadNativeStatsSnapshot GetStationheadNativeStatsSnapshot() {
  return {};
}

uint64_t GetStationheadNativeStatsRevision() {
  return 0;
}

}  // namespace hp
