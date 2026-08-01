#include "app.h"
#include "stationhead_playback_gate.h"

namespace hp {
namespace {
constexpr int64_t kStationheadClockSlotMs = 30'000;
constexpr int64_t kStationheadClockFreshAudioDelayMs = 1'000;
constexpr UINT kStationheadClockMinimumTimerMs = 50;

constexpr UINT StationheadDelayToNextClockSlot(int64_t nowMs) noexcept {
  if (nowMs <= 0) return 1'000;
  const int64_t remainder = nowMs % kStationheadClockSlotMs;
  const int64_t delay = remainder == 0
      ? kStationheadClockSlotMs
      : kStationheadClockSlotMs - remainder;
  return static_cast<UINT>(std::clamp<int64_t>(
      delay, kStationheadClockMinimumTimerMs, kStationheadClockSlotMs));
}

constexpr bool StationheadClockAudioIsFresh(
    int64_t switchStartedAt, int64_t audioPlayingSince) noexcept {
  return switchStartedAt > 0 && audioPlayingSince >=
      switchStartedAt + kStationheadClockFreshAudioDelayMs;
}

bool StationheadUrlMatches(
    const std::wstring& current, const std::wstring& expected) noexcept {
  return !current.empty() && !expected.empty() &&
      _wcsicmp(current.c_str(), expected.c_str()) == 0;
}

static_assert(kStationheadClockSlotMs == 30'000);
static_assert(StationheadDelayToNextClockSlot(30'000) == 30'000);
static_assert(StationheadDelayToNextClockSlot(30'001) == 29'999);
static_assert(StationheadDelayToNextClockSlot(59'999) == 50);
static_assert(!StationheadClockAudioIsFresh(1'000, 1'999));
static_assert(StationheadClockAudioIsFresh(1'000, 2'000));
}  // namespace

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
    if (App* app = Current()) {
      app->CompleteStationheadClockAudioHandoff(state, secondaryStatus);
      app->ArmStationheadClockSwitchTimer();
    }
    return;
  }
  state.secondaryContentRevision = 0;
  state.secondaryAudioMuted = false;
  state.secondaryPlaying = false;
  state.secondaryUrl.clear();
  if (App* app = Current()) {
    if (app->stationheadClockSwitchTimerArmed_ && app->window_) {
      KillTimer(app->window_, kStationheadClockSwitchTimerId);
    }
    app->stationheadClockSwitchTimerArmed_ = false;
    app->stationheadClockPendingAudioWindow_ = -1;
    app->stationheadClockSwitchStartedAt_ = 0;
  }
}

void App::ArmStationheadClockSwitchTimer() noexcept {
  if (!window_ || !IsWindow(window_) || !secondaryStarted_ ||
      !stationhead_ || !secondaryStationhead_ ||
      stationheadClockSwitchTimerArmed_) {
    return;
  }

  const UINT delay = StationheadDelayToNextClockSlot(UnixMillis());
  if (SetTimer(
          window_, kStationheadClockSwitchTimerId, delay,
          &App::StationheadClockSwitchTimerProc) == 0) {
    if (logger_) {
      logger_->Warn(
          L"Stationhead half-minute destination timer could not be armed");
    }
    return;
  }
  stationheadClockSwitchTimerArmed_ = true;
}

void CALLBACK App::StationheadClockSwitchTimerProc(
    HWND, UINT, UINT_PTR timerId, DWORD) {
  if (timerId != kStationheadClockSwitchTimerId) return;
  App* app = Current();
  if (!app || !app->window_) return;

  KillTimer(app->window_, kStationheadClockSwitchTimerId);
  app->stationheadClockSwitchTimerArmed_ = false;
  app->HandleStationheadClockSwitch();
  app->ArmStationheadClockSwitchTimer();
}

void App::HandleStationheadClockSwitch() noexcept {
  if (!stationhead_ || !secondaryStationhead_) return;

  const int64_t nowMs = UnixMillis();
  if (nowMs <= 0) return;
  const int64_t clockSlot = nowMs / kStationheadClockSlotMs;
  if (clockSlot == stationheadLastClockSlot_) return;
  stationheadLastClockSlot_ = clockSlot;

  if (stationheadClockPendingAudioWindow_ >= 0) {
    if (logger_) {
      logger_->Warn(
          L"Stationhead clock destination switch skipped because the previous window is still recovering");
    }
    return;
  }

  // Unix epoch minutes begin on a :00 boundary. Even half-minute slots are
  // therefore each minute's :00 event; odd slots are the matching :30 event.
  const bool switchPrimary = (clockSlot % 2) == 0;
  bool& usesBuddy46 = switchPrimary
      ? stationheadPrimaryUsesBuddy46_
      : stationheadSecondaryUsesBuddy46_;
  const StationheadStatus currentStatus = switchPrimary
      ? stationhead_->Status()
      : secondaryStationhead_->Status();
  if (!currentStatus.url.empty()) {
    usesBuddy46 = StationheadUrlMatches(
        currentStatus.url, config_.stationhead.alternateUrl);
  }
  const bool nextUsesBuddy46 = !usesBuddy46;
  if (!nextUsesBuddy46) {
    // Reuse the shared five-minute playback JSON sample. A clock boundary must
    // never issue its own network request; missing, failed, stale, or invalid
    // cached data keeps the selected window on buddy46.
    if (!StationheadPrimaryPlaybackAvailableCached()) {
      if (logger_) {
        logger_->Info(
            switchPrimary
                ? L"Stationhead :00 A kept buddy46 because the five-minute playback JSON cache has no valid sakuramankai track"
                : L"Stationhead :30 B kept buddy46 because the five-minute playback JSON cache has no valid sakuramankai track");
      }
      return;
    }
  }

  const std::wstring& targetUrl = nextUsesBuddy46
      ? config_.stationhead.alternateUrl
      : config_.stationhead.primaryUrl;
  if (targetUrl.empty()) return;

  // Keep the already-loaded opposite player audible while the selected clock
  // window navigates and repeats its native Start Listening click in the 1x1
  // behind-dashboard surface. Hand audio to the changed window only after its
  // native WebView2 audio state reports recovery.
  const bool previousPrimaryAudible = scheduledPrimaryAudioAudible_;
  ApplyScheduledStationheadAudioProfile(!switchPrimary);
  const std::wstring reason = switchPrimary
      ? L"clock minute-zero destination switch"
      : L"clock minute-thirty destination switch";
  const bool switched = switchPrimary
      ? stationhead_->SwitchClockStationDestination(targetUrl, reason)
      : secondaryStationhead_->SwitchClockStationDestination(targetUrl, reason);
  if (!switched) {
    ApplyScheduledStationheadAudioProfile(previousPrimaryAudible);
    if (logger_) {
      logger_->Warn(
          switchPrimary
              ? L"Stationhead :00 A switch skipped because the window was busy"
              : L"Stationhead :30 B switch skipped because the window was busy");
    }
    return;
  }

  usesBuddy46 = nextUsesBuddy46;
  stationheadClockPendingAudioWindow_ = switchPrimary ? 0 : 1;
  stationheadClockSwitchStartedAt_ = nowMs;
  if (logger_) {
    logger_->Info(
        std::wstring(switchPrimary
                         ? L"Stationhead clock :00 switched A to "
                         : L"Stationhead clock :30 switched B to ") +
        (nextUsesBuddy46 ? L"buddy46" : L"sakuramankai"));
  }
}

void App::CompleteStationheadClockAudioHandoff(
    const StationheadStatus& primary,
    const StationheadStatus* secondary) noexcept {
  const bool primaryAudioFresh = StationheadClockAudioIsFresh(
      stationheadClockSwitchStartedAt_, stationhead_->AudioPlayingSince());
  if (stationheadClockPendingAudioWindow_ == 0 && primary.audioPlaying &&
      primaryAudioFresh && stationhead_->ClockStationNavigationSettled()) {
    ApplyScheduledStationheadAudioProfile(true);
    stationheadClockPendingAudioWindow_ = -1;
    stationheadClockSwitchStartedAt_ = 0;
    if (logger_) {
      logger_->Info(
          L"Stationhead clock switch handed audio to A after fresh navigation playback recovery");
    }
    return;
  }
  const bool secondaryAudioFresh = secondary && StationheadClockAudioIsFresh(
      stationheadClockSwitchStartedAt_,
      secondaryStationhead_->AudioPlayingSince());
  if (stationheadClockPendingAudioWindow_ == 1 && secondary &&
      secondary->audioPlaying && secondaryAudioFresh &&
      secondaryStationhead_->ClockStationNavigationSettled()) {
    ApplyScheduledStationheadAudioProfile(false);
    stationheadClockPendingAudioWindow_ = -1;
    stationheadClockSwitchStartedAt_ = 0;
    if (logger_) {
      logger_->Info(
          L"Stationhead clock switch handed audio to B after fresh navigation playback recovery");
    }
  }
}

void App::ToggleStationheadAudio() {
  const bool primaryAudible = secondaryStationhead_
      ? !scheduledPrimaryAudioAudible_
      : true;
  stationheadAudioMuted_ = false;
  stationheadClockPendingAudioWindow_ = -1;
  stationheadClockSwitchStartedAt_ = 0;
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
