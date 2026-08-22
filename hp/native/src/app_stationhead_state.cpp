#include "app.h"

namespace hp {

void App::EnrichRenderStationheadState(
    StationheadStatus& state,
    StationheadStatus* secondaryStatus,
    const StationheadConfig& config) {
#if 0  // Stationhead disabled while the MV panel is active.
  state.fallbackUrl = config.fallbackUrl;
  if (secondaryStatus) {
    state.secondaryContentRevision = secondaryStatus->contentRevision;
    state.loginRequired = state.loginRequired || secondaryStatus->loginRequired;
    state.spotifyAuthorization =
        state.spotifyAuthorization || secondaryStatus->spotifyAuthorization;
    state.processFailed = state.processFailed || secondaryStatus->processFailed;
    state.secondaryAudioMuted = secondaryStatus->audioMuted;
    state.secondaryPlaying = secondaryStatus->playing;
    state.secondaryUrl = std::move(secondaryStatus->url);
    return;
  }
  state.secondaryContentRevision = 0;
  state.secondaryAudioMuted = false;
  state.secondaryPlaying = false;
  state.secondaryUrl.clear();
#else
  (void)state;
  (void)secondaryStatus;
  (void)config;
#endif
}

void App::ToggleStationheadAudio() {
#if 0  // Stationhead disabled.
  const bool primaryAudible = secondaryStationhead_
      ? !scheduledPrimaryAudioAudible_
      : true;
  stationheadAudioMuted_ = false;
  ApplyScheduledStationheadAudioProfile(primaryAudible);
  ShowToast(primaryAudible ? L"A 音声ON" : L"B 音声ON", 3000, false);
  InvalidateAll();
#endif
}

void App::MuteStationheadAudio() {
#if 0  // Stationhead disabled.
  stationheadAudioMuted_ = true;
  ApplyScheduledStationheadAudioProfile(scheduledPrimaryAudioAudible_);
  ShowToast(L"MUTE", 3000, false);
  InvalidateAll();
#endif
}

}  // namespace hp
