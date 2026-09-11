namespace hp {

SpotifyWebViews::MusicTargetDescriptor SpotifyWebViews::ResolveMusicTarget(
    const Slot& slot) const noexcept {
  if (slot.timedTarget != TimedSpotifyTarget::Music ||
      slot.timedRotationPosition >= slot.timedCycleTracks.size()) {
    return {};
  }
  const ManagedTrack& track = slot.timedCycleTracks[slot.timedRotationPosition];
  return {track.title.c_str(), track.url.c_str(), track.path.c_str()};
}

bool SpotifyWebViews::SlotMatchesMusicTarget(const Slot& slot) const noexcept {
  if (!slot.webview) return false;
  const MusicTargetDescriptor target = ResolveMusicTarget(slot);
  if (!target.path) return false;

  LPWSTR rawSource = nullptr;
  if (FAILED(slot.webview->get_Source(&rawSource)) || !rawSource) return false;
  const std::wstring source(rawSource);
  CoTaskMemFree(rawSource);
  return IsSpotifyOpenSource(source) && source.find(target.path) != std::wstring::npos;
}

void SpotifyWebViews::NavigateMusicTarget(Slot& slot) noexcept {
  if (!slot.webview) return;
  const MusicTargetDescriptor target = ResolveMusicTarget(slot);
  if (!target.url) return;

  slot.lastModeNavigateTick = GetTickCount64();
  slot.shuffleOffVerified = false;
  slot.repeatOffVerified = false;
  SetSlotState(slot, SlotState::Navigating);
  SetSpotifyOutputMuted(slot.webview);
  PostSpotifyTargetDescriptorForSlot(slot);
  slot.webview->ExecuteScript(kSpotifyStaticStopPlaybackScript, nullptr);
  RecomputeForeground();
  const HRESULT result = slot.webview->Navigate(target.url);
  if (FAILED(result)) {
    slot.lastModeNavigateTick = 0;
    MarkSlotRecovering(slot, GetTickCount64());
  }
  ArmRobustScheduler();
}

void SpotifyWebViews::ReconcileMusicTarget(Slot& slot) noexcept {
  if (!slot.hostWindow || !IsWindow(slot.hostWindow)) return;
  if (!slot.webview) {
    BeginControllerCreate(slot);
    return;
  }
  slot.controllerCreating = false;
  slot.controllerCreateTick = 0;

  if (SlotIsLoginPage(slot) || !ResolveMusicTarget(slot).url) return;

  if (!SlotMatchesMusicTarget(slot)) {
    const ULONGLONG now = GetTickCount64();
    MarkSlotRecovering(slot, now);
    if (slot.lastModeNavigateTick == 0 ||
        now - slot.lastModeNavigateTick >= kSpotifyRobustNavigateRetryMs) {
      NavigateMusicTarget(slot);
    }
    return;
  }

  slot.lastModeNavigateTick = 0;
  if (!EnsurePlaybackModeOff(slot, PlaybackModeGuard::Shuffle)) return;
  if (!EnsurePlaybackModeOff(slot, PlaybackModeGuard::Repeat)) return;
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
      kSpotifyStaticTrackReconcileScript,
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
            if (!started_ || requestedGeneration != target->targetGeneration ||
                !ResolveMusicTarget(*target).url) {
              return S_OK;
            }

            const ULONGLONG now = GetTickCount64();
            if (FAILED(result)) {
              MarkSlotRecovering(*target, now);
              if (ShouldRenavigateUnhealthySlot(*target, now)) {
                NavigateMusicTarget(*target);
              } else {
                RecomputeForeground();
                ArmRobustScheduler();
              }
              return S_OK;
            }

            if (json && std::wstring_view(json) == L"true") {
              // The DOM control can briefly report "Pause" before the actual
              // media clock starts. Only the generation-tagged observer may
              // promote a slot to Playing after confirmed media playback.
              if (target->state != SlotState::Playing) {
                SetSlotState(*target, SlotState::WaitingTarget);
              }
              RecomputeForeground();
              ArmRobustScheduler();
              return S_OK;
            }

            int x = 0;
            int y = 0;
            if (ParseNormalizedPoint(json, &x, &y)) {
              if (target->unhealthySinceTick == 0) target->unhealthySinceTick = now;
              if (ShouldRenavigateUnhealthySlot(*target, now)) {
                NavigateMusicTarget(*target);
              } else {
                ClickSlotNormalizedPoint(*target, x, y);
                ArmRobustScheduler();
              }
              return S_OK;
            }

            MarkSlotRecovering(*target, now);
            if (ShouldRenavigateUnhealthySlot(*target, now)) {
              NavigateMusicTarget(*target);
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
      NavigateMusicTarget(slot);
    } else {
      RecomputeForeground();
      ArmRobustScheduler();
    }
  }
}

}  // namespace hp
