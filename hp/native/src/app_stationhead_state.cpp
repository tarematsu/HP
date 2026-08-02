#include "app.h"

namespace hp {

void App::EnrichRenderStationheadState(
    StationheadStatus& state,
    StationheadStatus* secondaryStatus,
    const StationheadConfig& config) {
  state.fallbackUrl = config.fallbackUrl;
  if (secondaryStatus) {
    state.secondaryContentRevision = secondaryStatus->contentRevision;
    // The dashboard exposes one combined Stationhead health line. Preserve the
    // primary playback fields, but surface interactive/error states from either
    // window so a failed or authorizing B window is not hidden by a healthy A.
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
}

void App::ToggleStationheadAudio() {
  const bool primaryAudible = secondaryStationhead_
      ? !scheduledPrimaryAudioAudible_
      : true;
  stationheadAudioMuted_ = false;
  ApplyScheduledStationheadAudioProfile(primaryAudible);
  ShowToast(primaryAudible ? L"A 音声ON" : L"B 音声ON", 3000, false);
  InvalidateAll();
}

void App::MuteStationheadAudio() {
  stationheadAudioMuted_ = true;
  ApplyScheduledStationheadAudioProfile(scheduledPrimaryAudioAudible_);
  ShowToast(L"MUTE", 3000, false);
  InvalidateAll();
}

}  // namespace hp
