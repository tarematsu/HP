#include "app.h"

namespace hp {

void App::EnrichRenderStationheadState(
    StationheadStatus& state,
    StationheadStatus* secondaryStatus,
    const StationheadConfig& config) {
  state.fallbackUrl = config.fallbackUrl;
  if (secondaryStatus) {
    state.loginRequired = state.loginRequired || secondaryStatus->loginRequired;
    state.secondaryAudioMuted = secondaryStatus->audioMuted;
    state.secondaryPlaying = secondaryStatus->playing;
    state.secondaryUrl = std::move(secondaryStatus->url);
    return;
  }
  state.secondaryAudioMuted = false;
  state.secondaryPlaying = false;
  state.secondaryUrl.clear();
}

}  // namespace hp
