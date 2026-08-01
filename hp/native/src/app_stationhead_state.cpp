#include "app.h"

namespace hp {

void App::EnrichRenderStationheadState(
    StationheadStatus& state,
    StationheadStatus* secondaryStatus,
    const StationheadConfig& config) {
  state.fallbackUrl = config.fallbackUrl;
  if (secondaryStatus) {
    const bool bothPlaying = state.audioPlaying && secondaryStatus->audioPlaying;
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
    if (App* app = Current()) {
      app->UpdateStationheadAlternationTimer(bothPlaying);
    }
    return;
  }
  state.secondaryContentRevision = 0;
  state.secondaryAudioMuted = false;
  state.secondaryPlaying = false;
  state.secondaryUrl.clear();
  if (App* app = Current()) {
    app->UpdateStationheadAlternationTimer(false);
  }
}

void App::UpdateStationheadAlternationTimer(bool bothPlaying) noexcept {
  if (!window_ || !IsWindow(window_)) return;
  if (bothPlaying) {
    if (stationheadAlternationTimerArmed_) return;
    if (SetTimer(
            window_, kStationheadAlternationTimerId,
            kStationheadAlternationIntervalMs,
            &App::StationheadAlternationTimerProc) != 0) {
      stationheadAlternationTimerArmed_ = true;
      if (logger_) {
        logger_->Info(
            L"Stationhead A/B two-minute audio alternation armed");
      }
    } else if (logger_) {
      logger_->Warn(
          L"Stationhead A/B two-minute audio alternation timer could not be armed");
    }
    return;
  }

  if (!stationheadAlternationTimerArmed_) return;
  KillTimer(window_, kStationheadAlternationTimerId);
  stationheadAlternationTimerArmed_ = false;
  if (logger_) {
    logger_->Info(
        L"Stationhead A/B two-minute audio alternation paused until both streams recover");
  }
}

void CALLBACK App::StationheadAlternationTimerProc(
    HWND, UINT, UINT_PTR timerId, DWORD) {
  if (timerId != kStationheadAlternationTimerId) return;
  App* app = Current();
  if (!app) return;

  const bool bothPlaying = app->secondaryStarted_ &&
      app->stationhead_.AudioPlaying() &&
      app->secondaryStationhead_.AudioPlaying();
  if (!bothPlaying) {
    app->UpdateStationheadAlternationTimer(false);
    return;
  }

  app->scheduledPrimaryAudioAudible_ =
      !app->scheduledPrimaryAudioAudible_;
  app->ApplyScheduledStationheadAudioProfile(
      app->scheduledPrimaryAudioAudible_);
  if (app->logger_) {
    app->logger_->Info(
        app->scheduledPrimaryAudioAudible_
            ? L"Stationhead two-minute alternation selected sakuramankai (A)"
            : L"Stationhead two-minute alternation selected buddy46 (B)");
  }
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
