namespace hp {
namespace {

constexpr wchar_t kSpotifyBitterBlueUrl[] =
    L"https://open.spotify.com/track/5EjWZuODqEPQ9eq7XCmITh";
constexpr wchar_t kSpotifyBitterBluePath[] =
    L"/track/5EjWZuODqEPQ9eq7XCmITh";
constexpr wchar_t kSpotifyBitterBlueTitle[] = L"放課後BitterBlue";
constexpr wchar_t kSpotifyMonshirochoUrl[] =
    L"https://open.spotify.com/track/6VIY7OFy8g5ZyLSgQEi8lV";
constexpr wchar_t kSpotifyMonshirochoPath[] =
    L"/track/6VIY7OFy8g5ZyLSgQEi8lV";
constexpr wchar_t kSpotifyMonshirochoTitle[] = L"紋白蝶が確か飛んでた";
constexpr wchar_t kSpotifyMunenUrl[] =
    L"https://open.spotify.com/track/0rUT5nQpBjkg4SPY8jPjcO";
constexpr wchar_t kSpotifyMunenPath[] =
    L"/track/0rUT5nQpBjkg4SPY8jPjcO";
constexpr wchar_t kSpotifyMunenTitle[] = L"無念";
constexpr wchar_t kSpotifyOnMyWayUrl[] =
    L"https://open.spotify.com/track/2UHNvd8SjNGoEI6jXa2afx";
constexpr wchar_t kSpotifyOnMyWayPath[] =
    L"/track/2UHNvd8SjNGoEI6jXa2afx";
constexpr wchar_t kSpotifyOnMyWayTitle[] = L"On my way";
constexpr wchar_t kSpotifyLonesomeRabbitUrl[] =
    L"https://open.spotify.com/track/6Vy6hCA2CZwZalGqaX6Sew";
constexpr wchar_t kSpotifyLonesomeRabbitPath[] =
    L"/track/6Vy6hCA2CZwZalGqaX6Sew";
constexpr wchar_t kSpotifyLonesomeRabbitTitle[] = L"lonesome rabbit";

}  // namespace

bool SpotifyWebViews::SlotMatchesPodcastTarget(const Slot& slot) const noexcept {
  if (!slot.webview || slot.timedTarget != TimedSpotifyTarget::TalkAbout ||
      !SpotifyPodcastTargetReady()) {
    return false;
  }
  LPWSTR rawSource = nullptr;
  if (FAILED(slot.webview->get_Source(&rawSource)) || !rawSource) return false;
  const std::wstring source(rawSource);
  CoTaskMemFree(rawSource);
  return IsSpotifyOpenSource(source) &&
         source.find(SpotifyPodcastPath()) != std::wstring::npos;
}

void SpotifyWebViews::NavigatePodcastSlot(Slot& slot) noexcept {
  if (!slot.webview || slot.timedTarget != TimedSpotifyTarget::TalkAbout ||
      !SpotifyPodcastTargetReady()) {
    return;
  }

  slot.lastModeNavigateTick = GetTickCount64();
  SetSlotState(slot, SlotState::Navigating);
  SetSpotifyOutputMuted(slot.webview);
  PostSpotifyTargetDescriptorForSlot(slot);
  RecomputeForeground();

  // Podcast transitions follow the same single-actuator rule as music: the
  // navigation replaces the old target. A separate media.pause() can arrive
  // after the new item has begun and is therefore deliberately forbidden.
  const HRESULT result = slot.webview->Navigate(SpotifyPodcastUrl());
  if (FAILED(result)) {
    slot.lastModeNavigateTick = 0;
    MarkSlotRecovering(slot, GetTickCount64());
  }
  ArmRobustScheduler();
}

void SpotifyWebViews::ReconcilePodcastSlot(Slot& slot) noexcept {
  if (!slot.hostWindow || !IsWindow(slot.hostWindow) ||
      !SpotifyPodcastTargetReady()) {
    return;
  }
  if (!slot.webview) {
    BeginControllerCreate(slot);
    return;
  }
  slot.controllerCreating = false;
  slot.controllerCreateTick = 0;

  if (SlotIsLoginPage(slot) || slot.timedTarget != TimedSpotifyTarget::TalkAbout) {
    return;
  }

  if (!SlotMatchesPodcastTarget(slot)) {
    const ULONGLONG now = GetTickCount64();
    MarkSlotRecovering(slot, now);
    if (slot.lastModeNavigateTick == 0 ||
        now - slot.lastModeNavigateTick >= kSpotifyRobustNavigateRetryMs) {
      NavigatePodcastSlot(slot);
    }
    return;
  }

  slot.lastModeNavigateTick = 0;
  if (slot.reconcileInFlight) return;

  PostSpotifyTargetDescriptorForSlot(slot);
  ++slot.reconcileRequestGeneration;
  if (slot.reconcileRequestGeneration == 0) ++slot.reconcileRequestGeneration;
  const ULONGLONG reconcileRequestGeneration = slot.reconcileRequestGeneration;
  slot.reconcileInFlight = true;
  slot.reconcileStartedTick = GetTickCount64();
  const ULONGLONG requestedGeneration = slot.targetGeneration;
  Slot* const target = &slot;
  ComPtr<ICoreWebView2> requestedView = slot.webview;
  const auto alive = alive_;
  const HRESULT started = requestedView->ExecuteScript(
      kSpotifyStaticPodcastReconcileScript,
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [this, alive, target, requestedView, requestedGeneration,
           reconcileRequestGeneration](HRESULT result, LPCWSTR json) -> HRESULT {
            if (!alive->load(std::memory_order_acquire)) return S_OK;
            if (target->reconcileRequestGeneration != reconcileRequestGeneration ||
                target->webview.Get() != requestedView.Get()) {
              return S_OK;
            }
            target->reconcileInFlight = false;
            target->reconcileStartedTick = 0;
            if (!started_ || target->timedTarget != TimedSpotifyTarget::TalkAbout ||
                requestedGeneration != target->targetGeneration) {
              return S_OK;
            }

            const ULONGLONG now = GetTickCount64();
            if (FAILED(result)) {
              MarkSlotRecovering(*target, now);
              if (ShouldRenavigateUnhealthySlot(*target, now)) {
                NavigatePodcastSlot(*target);
              } else {
                RecomputeForeground();
                ArmRobustScheduler();
              }
              return S_OK;
            }

            if (json && std::wstring_view(json) == L"\"completed\"") {
              CompletePodcastBreak(*target, now);
              return S_OK;
            }

            if (json && std::wstring_view(json) == L"true") {
              // Podcast reconcile only returns true after a real play event and
              // an active media element, so this is a confirmed start.
              SetSlotState(*target, SlotState::Playing);
              RecomputeForeground();
              ArmRobustScheduler();
              return S_OK;
            }

            if (json && std::wstring_view(json) == L"\"settling\"") {
              SetSlotState(*target, SlotState::WaitingTarget);
              if (target->unhealthySinceTick == 0) target->unhealthySinceTick = now;
              if (ShouldRenavigateUnhealthySlot(*target, now)) {
                NavigatePodcastSlot(*target);
              } else {
                RecomputeForeground();
                ArmRobustScheduler();
              }
              return S_OK;
            }

            int x = 0;
            int y = 0;
            if (ParseNormalizedPoint(json, &x, &y)) {
              // Coordinates are emitted only for an explicit Play-labelled
              // episode control (or a repeat-mode correction), never Pause.
              if (target->unhealthySinceTick == 0) target->unhealthySinceTick = now;
              if (ShouldRenavigateUnhealthySlot(*target, now)) {
                NavigatePodcastSlot(*target);
              } else {
                ClickSlotNormalizedPoint(*target, x, y);
                ArmRobustScheduler();
              }
              return S_OK;
            }

            MarkSlotRecovering(*target, now);
            if (ShouldRenavigateUnhealthySlot(*target, now)) {
              NavigatePodcastSlot(*target);
            } else {
              RecomputeForeground();
              ArmRobustScheduler();
            }
            return S_OK;
          }).Get());

  if (FAILED(started)) {
    if (slot.reconcileRequestGeneration == reconcileRequestGeneration &&
        slot.webview.Get() == requestedView.Get()) {
      slot.reconcileInFlight = false;
      slot.reconcileStartedTick = 0;
    }
    const ULONGLONG now = GetTickCount64();
    MarkSlotRecovering(slot, now);
    if (ShouldRenavigateUnhealthySlot(slot, now)) {
      NavigatePodcastSlot(slot);
    } else {
      RecomputeForeground();
      ArmRobustScheduler();
    }
  }
}

}  // namespace hp
