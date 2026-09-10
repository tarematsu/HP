// Scheduled power-saving state, MV startup input pass, and media mute toggles.
namespace {
constexpr UINT kMvStartupPassHoldMs = 1'500;
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
}  // namespace

void PowerSavingController::CheckSchedule(bool force) {
  if (!overlay_) return;
  const int64_t now = UnixMillis();
  if (!scheduleInitialized_ || force || now >= nextScheduleBoundaryAt_) {
    scheduleInitialized_ = true;
    ApplyMode(ScheduledPowerSavingNow(now));
    nextScheduleBoundaryAt_ = NextScheduleBoundary(now);
  }
  ArmScheduleTimer();
}

void PowerSavingController::ArmScheduleTimer() {
  if (!overlay_) return;
  KillTimer(overlay_, kScheduleTimer);
  const int64_t remaining = std::max<int64_t>(
      1, nextScheduleBoundaryAt_ - UnixMillis());
  const UINT delay = static_cast<UINT>(std::clamp<int64_t>(
      remaining, 1, std::numeric_limits<UINT>::max()));
  SetTimer(overlay_, kScheduleTimer, delay, nullptr);
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
  if (!enabled && mvStartupInputPass_) {
    mvStartupInputPass_ = false;
    if (overlay_) KillTimer(overlay_, kMvStartupPassTimer);
  }
  const bool changed = powerSaving_ != enabled;
  powerSaving_ = enabled;
  if (enabled) {
    ApplyMinimumBrightness();
  } else {
    RestoreBrightness();
  }
  Renderer::SetGlobalPowerSavingMode(enabled);
  if (changed) LayoutOverlay();
  if (overlay_) InvalidateRect(overlay_, nullptr, FALSE);
}

void PowerSavingController::ApplyMediaMute(bool enabled) noexcept {
  mediaMuted_ = enabled;
  SetNativeMediaPanelMuted(enabled);
  if (overlay_) InvalidateRect(overlay_, nullptr, FALSE);
}
