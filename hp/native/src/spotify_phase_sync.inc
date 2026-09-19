#include "audio_health_scan_coordinator.h"
#include "spotify_permanent_resource_mode.h"

namespace hp {
namespace {

constexpr UINT kSpotifySchedulerBootstrapMs = 2U * 1000U;
constexpr UINT kSpotifyHealthyAuditMs = 60U * 60U * 1000U;
constexpr UINT kSpotifySchedulerFloorMs = 100U;
constexpr ULONGLONG kSpotifyRecoveryRetryMs = 5ULL * 1000ULL;
constexpr ULONGLONG kSpotifyControllerRetryMs = 20ULL * 1000ULL;
constexpr ULONGLONG kSpotifyAsyncOperationTimeoutMs = 30ULL * 1000ULL;
constexpr ULONGLONG kSpotifyNativeAudioStartRetryMs = 2ULL * 1000ULL;
constexpr ULONGLONG kSpotifyAudioHealthCheckMs = 30ULL * 1000ULL;
constexpr ULONGLONG kSpotifyAudioHealthLaneSpacingMs = 5ULL * 1000ULL;
constexpr ULONGLONG kSpotifyAudioHealthRetryMs = kAudioHealthScanRetryMs;
constexpr ULONGLONG kSpotifyAudioHealthSilenceConfirmMs = 5ULL * 1000ULL;
constexpr wchar_t kSpotifyStatusWindowClass[] = L"HomePanelNativeSpotifyStatus";
std::array<ULONGLONG, kSpotifyActiveAccountCount>
    gSpotifyAudioHealthCheckDueTicks{};
std::array<ULONGLONG, kSpotifyActiveAccountCount>
    gSpotifyAudioHealthSilenceConfirmTicks{};

void InvalidateSpotifyStatusForHost(HWND hostWindow) noexcept {
  if (!hostWindow || !IsWindow(hostWindow)) return;
  HWND parent = GetParent(hostWindow);
  if (!parent || !IsWindow(parent)) return;
  HWND status = FindWindowExW(parent, nullptr, kSpotifyStatusWindowClass, nullptr);
  if (status && IsWindow(status)) InvalidateRect(status, nullptr, FALSE);
}

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

ULONGLONG FirstSpotifyAudioHealthTick(
    ULONGLONG now, size_t accountIndex) noexcept {
  const int lane = SpotifyRuntimeLaneForAccount(accountIndex);
  if (lane < 0) return 0;
  return now +
      (static_cast<ULONGLONG>(lane) + 1ULL) *
          kSpotifyAudioHealthLaneSpacingMs;
}

}  // namespace

bool SpotifyWebViews::SlotStateIsHealthy(SlotState state) noexcept {
  return state == SlotState::Playing;
}

bool SpotifyWebViews::SlotStateNeedsRecovery(SlotState state) noexcept {
  return state == SlotState::NotCreated || state == SlotState::Navigating ||
         state == SlotState::WaitingTarget || state == SlotState::Recovering;
}

void SpotifyWebViews::SetSlotState(Slot& slot, SlotState state) noexcept {
  const SlotState previousState = slot.state;
  slot.state = state;
  ApplySpotifyPermanentResourceMode(slot);

  if (slot.index < gSpotifyAudioHealthCheckDueTicks.size()) {
    ULONGLONG& due = gSpotifyAudioHealthCheckDueTicks[slot.index];
    ULONGLONG& silenceConfirm =
        gSpotifyAudioHealthSilenceConfirmTicks[slot.index];
    if (state == SlotState::Playing) {
      if (previousState != SlotState::Playing || due == 0) {
        due = FirstSpotifyAudioHealthTick(GetTickCount64(), slot.index);
        silenceConfirm = 0;
      }
    } else {
      due = 0;
      silenceConfirm = 0;
    }
  }

  if (state == SlotState::NotCreated || state == SlotState::Authenticating) {
    slot.nextRecoveryTick = 0;
    return;
  }
  if (state == SlotState::Playing) {
    // Startup verification remains the fast per-track gate. Once verified, the
    // native watchdog keeps checking the same WebView while it stays Playing.
    if (slot.nativeAudioStartVerified) {
      slot.nextRecoveryTick = 0;
    } else if (slot.nextRecoveryTick == 0) {
      slot.nextRecoveryTick = GetTickCount64() + kSpotifyNativeAudioStartRetryMs;
    }
  }
}

void SpotifyWebViews::MarkSlotRecovering(
    Slot& slot, ULONGLONG now) noexcept {
  SetSlotState(slot, SlotState::Recovering);
  slot.nextRecoveryTick = now + kSpotifyRecoveryRetryMs;
}

bool SpotifyWebViews::ExpireStaleAsyncWork(
    Slot& slot, ULONGLONG now) noexcept {
  // A slot can pass startup verification and later lose its renderer/audio sink
  // without a DOM pause, process-failure, DRM, or network event. Probe each live
  // Spotify WebView directly so a silent S1-S5 lane cannot remain healthy just
  // because its media clock and Pause button still look normal.
  if (slot.index < gSpotifyAudioHealthCheckDueTicks.size()) {
    ULONGLONG& due = gSpotifyAudioHealthCheckDueTicks[slot.index];
    ULONGLONG& silenceConfirm =
        gSpotifyAudioHealthSilenceConfirmTicks[slot.index];
    const bool audioHealthEligible =
        slot.webview && !slot.loginPage && CurrentMusicTrack(slot) &&
        SlotStateIsHealthy(slot.state) && slot.playbackConfirmed &&
        slot.nativeAudioStartVerified && slot.asyncWork == AsyncWork::None;

    if (audioHealthEligible) {
      if (due == 0) due = FirstSpotifyAudioHealthTick(now, slot.index);
      if (due != 0 && now >= due) {
        if (!TryClaimAudioHealthScan(now)) {
          due = now + kSpotifyAudioHealthRetryMs;
        } else {
          ComPtr<ICoreWebView2_8> audioView;
          BOOL nativePlaying = FALSE;
          const HRESULT interfaceResult = slot.webview.As(&audioView);
          const HRESULT stateResult =
              SUCCEEDED(interfaceResult) && audioView
                  ? audioView->get_IsDocumentPlayingAudio(&nativePlaying)
                  : E_NOINTERFACE;
          ReleaseAudioHealthScan();

          if (FAILED(interfaceResult) || !audioView || FAILED(stateResult)) {
            due = now + kSpotifyAudioHealthRetryMs;
          } else if (nativePlaying != FALSE) {
            silenceConfirm = 0;
            ObserveMediaRecoveryHealthy(
                slot.recoveryEpisode, now, slot.targetGeneration);
            due = now + kSpotifyAudioHealthCheckMs;
          } else if (silenceConfirm == 0) {
            // Track boundaries and short decoder handoffs can briefly report no
            // document audio. Require a second native miss before recovery.
            silenceConfirm = now + kSpotifyAudioHealthSilenceConfirmMs;
            due = silenceConfirm;
          } else if (now < silenceConfirm) {
            due = silenceConfirm;
          } else {
            // Re-enter the existing per-track startup path for this slot only.
            // That path first reasserts playback, then escalates through Reload,
            // WebView rebuild and finally Skip if native audio still never starts.
            slot.nativeAudioStartChecks = 0;
            slot.nativeAudioStartVerified = false;
            slot.playbackConfirmed = false;
            slot.timedCompletionDeadlineTick = 0;
            slot.timedCompletionDeadlineGeneration = 0;
            slot.trustedClickBlockedUntilTick = 0;
            SetSlotState(slot, SlotState::WaitingTarget);
            slot.nextRecoveryTick = now;
            ArmRobustScheduler();
            return true;
          }
        }
      }
    }
  }

  if (slot.asyncWork == AsyncWork::None || slot.asyncStartedTick == 0 ||
      now - slot.asyncStartedTick < kSpotifyAsyncOperationTimeoutMs) {
    return false;
  }

  const bool observerExpired = slot.asyncWork == AsyncWork::Observer;
  ++slot.asyncEpoch;
  if (slot.asyncEpoch == 0) ++slot.asyncEpoch;
  slot.asyncWork = AsyncWork::None;
  slot.asyncStartedTick = 0;
  if (observerExpired) slot.timedObserverReady = false;
  MarkSlotRecovering(slot, now);
  return true;
}

void SpotifyWebViews::BumpSpotifyTargetGeneration(Slot& slot) noexcept {
  ++slot.targetGeneration;
  if (slot.targetGeneration == 0) ++slot.targetGeneration;
  BeginSpotifyMediaStartEvidenceGeneration(slot.index, slot.targetGeneration);
  BeginSpotifyTrackStartRecovery(
      slot.trackStartRecovery, slot.targetGeneration, GetTickCount64());
  slot.nativeAudioStartChecks = 0;
  slot.nativeAudioStartVerified = false;
  slot.mediaPipelineRecoveryGeneration = 0;
  slot.mediaKeyWaitUntilTick = 0;
  slot.mediaNetworkRecoveryTick = 0;
  slot.mediaNetworkRecoveryAttempt = 0;
  slot.mediaKeyWaitFailurePending = false;
  slot.mediaNetworkRecoveryPending = false;
  ResetMediaRecoveryEpisode(slot.recoveryEpisode, slot.targetGeneration);
  if (slot.index < gSpotifyAudioHealthCheckDueTicks.size()) {
    gSpotifyAudioHealthCheckDueTicks[slot.index] = 0;
    gSpotifyAudioHealthSilenceConfirmTicks[slot.index] = 0;
  }
}

void CALLBACK SpotifyWebViews::SchedulerTimerProc(
    PTP_CALLBACK_INSTANCE, PVOID context, PTP_TIMER) {
  auto* owner = static_cast<SpotifyWebViews*>(context);
  if (!owner) return;

  HWND host = owner->schedulerHost_.load(std::memory_order_acquire);
  if (!host) return;

  bool expected = false;
  if (!owner->schedulerWakePosted_.compare_exchange_strong(
          expected, true, std::memory_order_acq_rel)) {
    return;
  }
  if (!PostMessageW(host, kSpotifySchedulerMessage, 0, 0)) {
    owner->schedulerWakePosted_.store(false, std::memory_order_release);
  }
}

UINT SpotifyWebViews::NextRobustSchedulerDelayMs(
    ULONGLONG now) const noexcept {
  if (!initialCloudPlaylistReady_) return kSpotifySchedulerBootstrapMs;

  // Healthy Spotify playback keeps event/deadline recovery, plus one cheap
  // native-audio getter per lane every 30 seconds. The five lanes start five
  // seconds apart so low-end systems never probe every WebView at once.
  ULONGLONG nextDelayMs = kSpotifyHealthyAuditMs;
  const auto considerTick = [&nextDelayMs, now](ULONGLONG dueTick) noexcept {
    if (dueTick == 0) return;
    nextDelayMs = std::min(
        nextDelayMs, dueTick <= now ? 0ULL : dueTick - now);
  };

  for (const Slot& slot : slots_) {
    if (slot.index < gSpotifyAudioHealthCheckDueTicks.size() &&
        slot.webview && CurrentMusicTrack(slot) &&
        SlotStateIsHealthy(slot.state) && slot.nativeAudioStartVerified) {
      considerTick(gSpotifyAudioHealthCheckDueTicks[slot.index]);
    }
    if (slot.timedCompletionDeadlineTick != 0 &&
        slot.timedCompletionDeadlineGeneration == slot.targetGeneration &&
        CurrentMusicTrack(slot)) {
      considerTick(slot.timedCompletionDeadlineTick);
    }
    considerTick(slot.mediaKeyWaitUntilTick);
    considerTick(slot.mediaNetworkRecoveryTick);

    if (slot.asyncWork != AsyncWork::None && slot.asyncStartedTick != 0) {
      considerTick(slot.asyncStartedTick + kSpotifyAsyncOperationTimeoutMs);
    }
    if (!slot.webview && slot.controllerCreateTick != 0) {
      considerTick(slot.controllerCreateTick + kSpotifyControllerRetryMs);
    }

    const bool startupAudioVerificationPending =
        SlotStateIsHealthy(slot.state) && !slot.nativeAudioStartVerified;
    if (CurrentMusicTrack(slot) &&
        (SlotStateNeedsRecovery(slot.state) || startupAudioVerificationPending) &&
        !slot.loginPage && slot.asyncWork == AsyncWork::None) {
      if (slot.nextRecoveryTick == 0) {
        nextDelayMs = 0;
      } else {
        considerTick(slot.nextRecoveryTick);
      }
    }
  }

  if (scheduleStartTick_ != 0) {
    for (size_t i = 0; i < slots_.size(); ++i) {
      if (!SpotifyAccountShouldOwnHost(i)) continue;
      const ULONGLONG boundary =
          scheduleStartTick_ +
          static_cast<ULONGLONG>(i) * kSpotifyAccountStartOffsetMs;
      if (now < boundary) {
        considerTick(boundary);
        continue;
      }

      const Slot& slot = slots_[i];
      if (slot.timedRotationActive || slot.loginPage ||
          !slot.hostWindow || !IsWindow(slot.hostWindow)) {
        continue;
      }
      if (!slot.webview) {
        if (slot.controllerCreating) continue;
        if (slot.controllerCreateTick != 0 &&
            now - slot.controllerCreateTick < kSpotifyControllerRetryMs) {
          continue;
        }
      }
      nextDelayMs = 0;
    }
  }

  return static_cast<UINT>(std::max<ULONGLONG>(
      kSpotifySchedulerFloorMs,
      std::min<ULONGLONG>(kSpotifyHealthyAuditMs, nextDelayMs)));
}

void SpotifyWebViews::ArmRobustScheduler() noexcept {
  if (!schedulerTimer_) {
    schedulerTimer_ = CreateThreadpoolTimer(
        &SpotifyWebViews::SchedulerTimerProc, this, nullptr);
    if (!schedulerTimer_) return;
  }

  if (!started_ || networkBlocked_) {
    SetThreadpoolTimer(schedulerTimer_, nullptr, 0, 0);
    return;
  }
  HWND host = schedulerHost_.load(std::memory_order_acquire);
  if (!host || !IsWindow(host)) {
    SetThreadpoolTimer(schedulerTimer_, nullptr, 0, 0);
    return;
  }

  const UINT delayMs = NextRobustSchedulerDelayMs(GetTickCount64());
  LARGE_INTEGER relativeDue{};
  relativeDue.QuadPart =
      -static_cast<LONGLONG>(static_cast<ULONGLONG>(delayMs) * 10000ULL);
  FILETIME due{};
  due.dwLowDateTime = relativeDue.LowPart;
  due.dwHighDateTime = relativeDue.HighPart;
  SetThreadpoolTimer(schedulerTimer_, &due, 0, 0);
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
  if (slot.controllerCreateTick != 0 &&
      now - slot.controllerCreateTick < kSpotifyControllerRetryMs) {
    return;
  }

  CreateController(slot);
}

}  // namespace hp