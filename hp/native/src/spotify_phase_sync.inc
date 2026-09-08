namespace hp {
namespace {

constexpr UINT_PTR kSpotifyRobustReconcileTimer = 0x53505243;
constexpr UINT kSpotifyRobustUrgentTickMs = 2U * 1000U;
constexpr UINT kSpotifyRobustHealthyTickMs = 20U * 1000U;
constexpr ULONGLONG kSpotifyRobustNavigateRetryMs = 20ULL * 1000ULL;
constexpr ULONGLONG kSpotifyRobustControllerRetryMs = 20ULL * 1000ULL;
constexpr ULONGLONG kSpotifyUnhealthyRenavigateMs = 60ULL * 1000ULL;
constexpr ULONGLONG kSpotifyAdaptiveSteadyStartMs = 20ULL * 60ULL * 1000ULL;
constexpr ULONGLONG kSpotifyAdaptiveTrackDeadlineMs = 4ULL * 60ULL * 1000ULL;

bool SpotifyUrlStartsWith(std::wstring_view value,
                          std::wstring_view prefix) noexcept {
  if (value.size() < prefix.size()) return false;
  for (size_t i = 0; i < prefix.size(); ++i) {
    if (towlower(value[i]) != towlower(prefix[i])) return false;
  }
  return true;
}

bool IsSpotifyOpenSource(std::wstring_view source) noexcept {
  return SpotifyUrlStartsWith(source, L"https://open.spotify.com/");
}

}  // namespace

bool SpotifyWebViews::SlotStateIsHealthy(SlotState state) noexcept {
  return state == SlotState::Playing || state == SlotState::Completed;
}

bool SpotifyWebViews::SlotStateNeedsRecovery(SlotState state) noexcept {
  return state == SlotState::NotCreated || state == SlotState::Navigating ||
         state == SlotState::WaitingTarget || state == SlotState::Recovering;
}

void SpotifyWebViews::SetSlotState(Slot& slot, SlotState state) noexcept {
  slot.state = state;
  if (state == SlotState::NotCreated || state == SlotState::Authenticating ||
      state == SlotState::Navigating || state == SlotState::Playing ||
      state == SlotState::Completed) {
    slot.unhealthySinceTick = 0;
  }
}

void SpotifyWebViews::MarkSlotRecovering(
    Slot& slot, ULONGLONG now) noexcept {
  slot.state = SlotState::Recovering;
  if (slot.unhealthySinceTick == 0) slot.unhealthySinceTick = now;
}

bool SpotifyWebViews::ShouldRenavigateUnhealthySlot(
    const Slot& slot, ULONGLONG now) const noexcept {
  return slot.unhealthySinceTick != 0 &&
         now - slot.unhealthySinceTick >= kSpotifyUnhealthyRenavigateMs &&
         (slot.lastModeNavigateTick == 0 ||
          now - slot.lastModeNavigateTick >= kSpotifyRobustNavigateRetryMs);
}

void SpotifyWebViews::BumpSpotifyTargetGeneration(Slot& slot) noexcept {
  ++slot.targetGeneration;
  if (slot.targetGeneration == 0) ++slot.targetGeneration;
}

UINT SpotifyWebViews::NextRobustSchedulerDelayMs(
    ULONGLONG now) const noexcept {
  if (!robustSchedulerStarted_) return kSpotifyRobustUrgentTickMs;

  ULONGLONG nextDeadlineMs = kSpotifyRobustHealthyTickMs;
  for (const Slot& slot : slots_) {
    const bool relevantRecovery =
        SlotStateNeedsRecovery(slot.state) &&
        (slot.timedTarget != TimedSpotifyTarget::None ||
         slot.loginPage || slot.controllerCreating);
    if (relevantRecovery) return kSpotifyRobustUrgentTickMs;

    if (slot.timedPlaybackStartTick != 0) {
      const ULONGLONG age = now - slot.timedPlaybackStartTick;
      if (age >= kSpotifyAdaptiveTrackDeadlineMs) {
        return kSpotifyRobustUrgentTickMs;
      }
      nextDeadlineMs = std::min(
          nextDeadlineMs, kSpotifyAdaptiveTrackDeadlineMs - age);
    }
  }

  if (youtubeCycleStartTick_ == 0 ||
      now - youtubeCycleStartTick_ < kSpotifyAdaptiveSteadyStartMs) {
    return kSpotifyRobustUrgentTickMs;
  }

  return static_cast<UINT>(std::max<ULONGLONG>(
      1000ULL, std::min<ULONGLONG>(
          kSpotifyRobustHealthyTickMs, nextDeadlineMs)));
}

void SpotifyWebViews::ArmRobustScheduler() noexcept {
  if (slots_.empty()) return;
  HWND host = slots_[0].hostWindow;
  if (!host || !IsWindow(host)) return;
  KillTimer(host, kSpotifyRobustReconcileTimer);
  const UINT delay = NextRobustSchedulerDelayMs(GetTickCount64());
  ::SetTimer(host, kSpotifyRobustReconcileTimer, delay,
             &SpotifyWebViews::StaggeredReconcileTimerProc);
}

bool SpotifyWebViews::SlotIsLoginPage(const Slot& slot) const noexcept {
  return slot.webview && slot.loginPage;
}

void SpotifyWebViews::BeginControllerCreate(Slot& slot) noexcept {
  if (!slot.hostWindow || !IsWindow(slot.hostWindow) ||
      slot.controller || slot.webview) {
    slot.controllerCreating = false;
    slot.controllerCreateTick = 0;
    return;
  }

  const ULONGLONG now = GetTickCount64();
  if (slot.controllerCreating && slot.controllerCreateTick != 0 &&
      now - slot.controllerCreateTick < kSpotifyRobustControllerRetryMs) {
    return;
  }

  SetSlotState(slot, SlotState::NotCreated);
  slot.controllerCreating = true;
  slot.controllerCreateTick = now;
  CreateController(slot);
}

bool SpotifyWebViews::ParseNormalizedPoint(
    LPCWSTR json, int* x, int* y) noexcept {
  if (!json || !x || !y) return false;
  try {
    const std::wstring value(json);
    if (value.size() < 5 || value.front() != L'[') return false;
    const size_t comma = value.find(L',');
    const size_t close = value.find(
        L']', comma == std::wstring::npos ? 0 : comma + 1);
    if (comma == std::wstring::npos || close == std::wstring::npos) return false;
    const int parsedX = std::stoi(value.substr(1, comma - 1));
    const int parsedY = std::stoi(value.substr(comma + 1, close - comma - 1));
    if (parsedX < 0 || parsedX > 10000 || parsedY < 0 || parsedY > 10000) {
      return false;
    }
    *x = parsedX;
    *y = parsedY;
    return true;
  } catch (...) {
    return false;
  }
}

void SpotifyWebViews::ClickSlotNormalizedPoint(
    Slot& slot, int xTenThousandths, int yTenThousandths) noexcept {
  if (!slot.webview || !slot.hostWindow || !IsWindow(slot.hostWindow)) return;
  SetSlotState(slot, SlotState::WaitingTarget);
  RefreshSpotifyHostLayout();
  DispatchSpotifyDevToolsClick(slot, xTenThousandths, yTenThousandths);
}

}  // namespace hp
