namespace hp {
namespace {

constexpr wchar_t kSpotifyBitterBlueUrl[] =
    L"https://open.spotify.com/track/5EjWZuODqEPQ9eq7XCmITh";
constexpr wchar_t kSpotifyBitterBluePath[] =
    L"/track/5EjWZuODqEPQ9eq7XCmITh";
constexpr wchar_t kSpotifyBitterBlueTitle[] = L"放課後BitterBlue";
constexpr wchar_t kSpotifyLonesomeRabbitUrl[] =
    L"https://open.spotify.com/track/6Vy6hCA2CZwZalGqaX6Sew";
constexpr wchar_t kSpotifyLonesomeRabbitPath[] =
    L"/track/6Vy6hCA2CZwZalGqaX6Sew";
constexpr wchar_t kSpotifyLonesomeRabbitTitle[] = L"lonesome rabbit";
constexpr wchar_t kSpotifyTalkAboutShowPath[] =
    L"/show/2ZQy2mlwQodabAILwZ02Ed";

}  // namespace

bool SpotifyWebViews::SlotMatchesPodcastTarget(const Slot& slot) const noexcept {
  if (!slot.webview || slot.timedTarget != TimedSpotifyTarget::TalkAbout) {
    return false;
  }
  LPWSTR rawSource = nullptr;
  if (FAILED(slot.webview->get_Source(&rawSource)) || !rawSource) return false;
  const std::wstring source(rawSource);
  CoTaskMemFree(rawSource);
  return IsSpotifyOpenSource(source) &&
         (source.find(kSpotifyTalkAboutShowPath) != std::wstring::npos ||
          source.find(L"/episode/") != std::wstring::npos);
}

void SpotifyWebViews::NavigatePodcastSlot(Slot& slot) noexcept {
  if (!slot.webview || slot.timedTarget != TimedSpotifyTarget::TalkAbout) return;

  slot.lastModeNavigateTick = GetTickCount64();
  SetSlotState(slot, SlotState::Navigating);
  SetSpotifyOutputMuted(slot.webview);
  PostSpotifyTargetDescriptorForSlot(slot);
  slot.webview->ExecuteScript(kSpotifyStaticStopPlaybackScript, nullptr);
  RecomputeForeground();
  const HRESULT result = slot.webview->Navigate(kSpotifyPodcastUrl);
  if (FAILED(result)) {
    slot.lastModeNavigateTick = 0;
    MarkSlotRecovering(slot, GetTickCount64());
  }
  ArmRobustScheduler();
}

void SpotifyWebViews::ReconcilePodcastSlot(Slot& slot) noexcept {
  if (!slot.hostWindow || !IsWindow(slot.hostWindow)) return;
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
              SetSlotState(*target, SlotState::Playing);
              RecomputeForeground();
              ArmRobustScheduler();
              return S_OK;
            }

            int x = 0;
            int y = 0;
            if (ParseNormalizedPoint(json, &x, &y)) {
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