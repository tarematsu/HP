// Scheduled power-saving state, MV startup input pass, and audio/monitor mode toggles.
namespace {
constexpr UINT kMvStartupPassHoldMs = 1'500;
constexpr int64_t kMonitorAuthProbeIntervalMs = 5 * 60'000;
constexpr int kPowerSavingStartMinute = 12 * 60;
constexpr int kPowerSavingEndMinute = 20 * 60;

constexpr bool ScheduledPowerSavingAt(int hour, int minute) noexcept {
  const int minuteOfDay = hour * 60 + minute;
  return minuteOfDay >= kPowerSavingStartMinute &&
      minuteOfDay < kPowerSavingEndMinute;
}

static_assert(!ScheduledPowerSavingAt(11, 59));
static_assert(ScheduledPowerSavingAt(12, 0));
static_assert(ScheduledPowerSavingAt(19, 59));
static_assert(!ScheduledPowerSavingAt(20, 0));
static_assert(kMonitorAuthProbeIntervalMs == 300'000);

bool ScheduledPowerSavingNow(int64_t nowMs) {
  const std::time_t seconds = static_cast<std::time_t>(nowMs / 1000);
  std::tm local{};
  if (localtime_s(&local, &seconds) != 0) return false;
  return ScheduledPowerSavingAt(local.tm_hour, local.tm_min);
}

int64_t NextScheduleBoundary(int64_t nowMs) {
  const std::time_t seconds = static_cast<std::time_t>(nowMs / 1000);
  std::tm boundary{};
  if (localtime_s(&boundary, &seconds) != 0) return nowMs + 60'000;

  const int minuteOfDay = boundary.tm_hour * 60 + boundary.tm_min;
  boundary.tm_sec = 0;
  boundary.tm_min = 0;
  if (minuteOfDay < kPowerSavingStartMinute) {
    boundary.tm_hour = 12;
  } else if (minuteOfDay < kPowerSavingEndMinute) {
    boundary.tm_hour = 20;
  } else {
    boundary.tm_hour = 12;
    ++boundary.tm_mday;
  }

  const std::time_t next = std::mktime(&boundary);
  return next == static_cast<std::time_t>(-1)
      ? nowMs + 60'000
      : static_cast<int64_t>(next) * 1000;
}

bool MonitorAuthProbeEnabled(MonitorMode mode) noexcept {
  return mode != MonitorMode::Off;
}
}  // namespace

void PowerSavingController::CheckSchedule(bool force) {
  if (!overlay_) return;
  const int64_t now = UnixMillis();
  if (!scheduleInitialized_ || force || now >= nextScheduleBoundaryAt_) {
    scheduleInitialized_ = true;
    ApplyMode(ScheduledPowerSavingNow(now));
    nextScheduleBoundaryAt_ = NextScheduleBoundary(now);
  }
  if (MonitorAuthProbeEnabled(monitorMode_)) RequestMonitorAuthProbe();
  ArmScheduleTimer();
}

void PowerSavingController::ArmScheduleTimer() {
  if (!overlay_) return;
  KillTimer(overlay_, kScheduleTimer);
  int64_t remaining = std::max<int64_t>(
      1, nextScheduleBoundaryAt_ - UnixMillis());
  if (MonitorAuthProbeEnabled(monitorMode_)) {
    remaining = std::min<int64_t>(remaining, kMonitorAuthProbeIntervalMs);
  }
  const UINT delay = static_cast<UINT>(std::clamp<int64_t>(
      remaining, 1, std::numeric_limits<UINT>::max()));
  SetTimer(overlay_, kScheduleTimer, delay, nullptr);
}

void PowerSavingController::RequestMonitorAuthProbe() noexcept {
  if (!MonitorAuthProbeEnabled(monitorMode_) || powerSaving_) return;
  RequestStationheadMonitorDomProbe();
  if (parent_ && IsWindow(parent_)) PostMessageW(parent_, WM_TIMER, 0, 0);
}

void PowerSavingController::OpenMvStartupInputPass() {
  if (!powerSaving_ || !overlay_ || !IsWindow(overlay_)) return;
  const bool changed = !mvStartupInputPass_;
  mvStartupInputPass_ = true;
  KillTimer(overlay_, kMvStartupPassTimer);
  SetTimer(overlay_, kMvStartupPassTimer, kMvStartupPassHoldMs, nullptr);
  if (changed) LayoutOverlay();
}

void PowerSavingController::CloseMvStartupInputPass() {
  if (overlay_ && IsWindow(overlay_)) {
    KillTimer(overlay_, kMvStartupPassTimer);
  }
  if (!mvStartupInputPass_) return;
  mvStartupInputPass_ = false;
  if (powerSaving_) LayoutOverlay();
}

void PowerSavingController::ApplyMode(bool enabled) {
  ApplyMonitorMode(enabled ? MonitorMode::Off : MonitorMode::Native);
}

void PowerSavingController::CycleMonitorMode() noexcept {
  switch (monitorMode_) {
    case MonitorMode::Native:
      ApplyMonitorMode(MonitorMode::ServiceGrid);
      break;
    case MonitorMode::ServiceGrid:
      ApplyMonitorMode(MonitorMode::Off);
      break;
    case MonitorMode::Off:
      ApplyMonitorMode(MonitorMode::Native);
      break;
  }
}

void PowerSavingController::ApplyMonitorMode(MonitorMode mode) noexcept {
  if (mode != MonitorMode::Off && mvStartupInputPass_) {
    mvStartupInputPass_ = false;
    if (overlay_) KillTimer(overlay_, kMvStartupPassTimer);
  }

  const bool nextPowerSaving = mode == MonitorMode::Off;
  const bool layoutChanged = powerSaving_ != nextPowerSaving;
  monitorMode_ = mode;
  powerSaving_ = nextPowerSaving;
  if (mode == MonitorMode::Off) monitorAuthForeground_ = false;

  if (powerSaving_) {
    ApplyMinimumBrightness();
  } else {
    RestoreBrightness();
  }
  Renderer::SetGlobalPowerSavingMode(powerSaving_);

  // Monitor S remains a six-window surface even while Stationhead temporarily
  // raises an authentication surface. Spotify playback/health state is never
  // coupled to Stationhead's interactive foreground state.
  SetSpotifyMonitorForegroundSlot(-1);
  SetSpotifyMonitorGridVisible(mode == MonitorMode::ServiceGrid);
  ApplyStationheadMonitorPlacement();

  if (layoutChanged) LayoutOverlay();
  if (MonitorAuthProbeEnabled(monitorMode_)) RequestMonitorAuthProbe();
  ArmScheduleTimer();
  if (overlay_) InvalidateRect(overlay_, nullptr, FALSE);
}

void PowerSavingController::CycleAudioMode() noexcept {
  switch (audioMode_) {
    case AudioMode::Media:
      ApplyAudioMode(AudioMode::Stationhead);
      break;
    case AudioMode::Stationhead:
      ApplyAudioMode(AudioMode::SpotifyPrimary);
      break;
    case AudioMode::SpotifyPrimary:
      ApplyAudioMode(AudioMode::SpotifySecondary);
      break;
    case AudioMode::SpotifySecondary:
      ApplyAudioMode(AudioMode::SpotifyTertiary);
      break;
    case AudioMode::SpotifyTertiary:
      ApplyAudioMode(AudioMode::SpotifyQuaternary);
      break;
    case AudioMode::SpotifyQuaternary:
      ApplyAudioMode(AudioMode::SpotifyQuinary);
      break;
    case AudioMode::SpotifyQuinary:
      ApplyAudioMode(AudioMode::Muted);
      break;
    case AudioMode::Muted:
      ApplyAudioMode(AudioMode::Media);
      break;
  }
}

void PowerSavingController::ApplyAudioMode(AudioMode mode) noexcept {
  audioMode_ = mode;
  mediaMuted_ = mode != AudioMode::Media;
  SetNativeMediaPanelMuted(mediaMuted_);
  const int spotifyAudioAccount =
      mode == AudioMode::SpotifyPrimary ? 0 :
      mode == AudioMode::SpotifySecondary ? 1 :
      mode == AudioMode::SpotifyTertiary ? 2 :
      mode == AudioMode::SpotifyQuaternary ? 3 :
      mode == AudioMode::SpotifyQuinary ? 4 : -1;
  SetSpotifyAudioOutputSlot(spotifyAudioAccount);

  if (parent_ && IsWindow(parent_)) {
    const UiAction stationheadAction = mode == AudioMode::Stationhead
        ? UiAction::StationheadAudioToggle
        : UiAction::StationheadAudioMute;
    SendMessageW(
        parent_, kRendererActionMessage,
        static_cast<WPARAM>(UiAction::StationheadAudioMute), 0);
    if (stationheadAction == UiAction::StationheadAudioToggle) {
      SendMessageW(
          parent_, kRendererActionMessage,
          static_cast<WPARAM>(stationheadAction), 0);
    }
  }

  if (overlay_) InvalidateRect(overlay_, nullptr, FALSE);
}
