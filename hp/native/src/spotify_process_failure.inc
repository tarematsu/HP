namespace hp {
namespace {

constexpr ULONGLONG kSpotifyAudioServiceRecoveryBaseDelayMs = 2ULL * 1000ULL;
constexpr ULONGLONG kSpotifyAudioServiceRecoveryLaneSpacingMs = 5ULL * 1000ULL;
constexpr ULONGLONG kSpotifyAudioServiceRecoveryDebounceMs = 10ULL * 1000ULL;
constexpr ULONGLONG kSpotifyRendererUnresponsiveWindowMs = 15ULL * 1000ULL;

std::array<ICoreWebView2*, kSpotifyActiveAccountCount>
    gSpotifyProcessFailureRegisteredWebviews{};
std::array<ULONGLONG, kSpotifyActiveAccountCount>
    gSpotifyRendererUnresponsiveFirstTicks{};
std::array<unsigned, kSpotifyActiveAccountCount>
    gSpotifyRendererUnresponsiveCounts{};
std::atomic<ULONGLONG> gSpotifyAudioServiceRecoveryLastTick{0};

bool SpotifyFailedProcessIsAudioService(
    ICoreWebView2ProcessFailedEventArgs* args) noexcept {
  if (!args) return false;
  ComPtr<ICoreWebView2ProcessFailedEventArgs2> details;
  if (FAILED(args->QueryInterface(IID_PPV_ARGS(&details))) || !details) {
    return false;
  }
  LPWSTR rawDescription = nullptr;
  if (FAILED(details->get_ProcessDescription(&rawDescription)) ||
      !rawDescription) {
    return false;
  }
  const std::wstring description(rawDescription);
  CoTaskMemFree(rawDescription);
  return MediaPipelineErrorContains(description, L"audio service") ||
         MediaPipelineErrorContains(description, L"audio");
}

}  // namespace

void SpotifyWebViews::EnsureProcessFailureMonitoring(
    ICoreWebView2* webview) noexcept {
  if (!webview || !started_) return;
  const int rawIndex = SlotIndexForWebView(webview);
  if (rawIndex < 0 ||
      rawIndex >= static_cast<int>(kSpotifyActiveAccountCount)) {
    return;
  }
  const size_t accountIndex = static_cast<size_t>(rawIndex);
  if (gSpotifyProcessFailureRegisteredWebviews[accountIndex] == webview) {
    return;
  }

  const auto alive = alive_;
  ICoreWebView2* const registeredWebview = webview;
  EventRegistrationToken token{};
  const HRESULT registered = webview->add_ProcessFailed(
      Callback<ICoreWebView2ProcessFailedEventHandler>(
          [this, alive, accountIndex, registeredWebview](
              ICoreWebView2* sender,
              ICoreWebView2ProcessFailedEventArgs* args) -> HRESULT {
            if (!alive || !alive->load(std::memory_order_acquire) ||
                !started_ || !sender || accountIndex >= slots_.size()) {
              return S_OK;
            }

            Slot& slot = slots_[accountIndex];
            if (slot.webview.Get() != sender || sender != registeredWebview) {
              return S_OK;
            }

            COREWEBVIEW2_PROCESS_FAILED_KIND kind{};
            if (!args || FAILED(args->get_ProcessFailedKind(&kind))) {
              return S_OK;
            }
            const ULONGLONG now = GetTickCount64();

            if (kind == COREWEBVIEW2_PROCESS_FAILED_KIND_UTILITY_PROCESS_EXITED) {
              // WebView2's Audio Service is shared by the Spotify WebViews.
              // A service restart can therefore leave every live media element
              // attached to the dead sink even when only one WebView reports the
              // utility-process failure. Recover every active Spotify lane, with
              // staggered reloads, instead of repairing only the reporting lane.
              if (!SpotifyFailedProcessIsAudioService(args)) return S_OK;
              const ULONGLONG previous =
                  gSpotifyAudioServiceRecoveryLastTick.load(std::memory_order_acquire);
              if (previous != 0 && now >= previous &&
                  now - previous < kSpotifyAudioServiceRecoveryDebounceMs) {
                return S_OK;
              }
              gSpotifyAudioServiceRecoveryLastTick.store(
                  now, std::memory_order_release);

              bool scheduledAny = false;
              for (Slot& target : slots_) {
                const int lane = SpotifyRuntimeLaneForAccount(target.index);
                if (lane < 0 || target.loginPage || !target.webview ||
                    !CurrentMusicTrack(target)) {
                  continue;
                }
                const MediaRecoveryAction action = NextMediaRecoveryAction(
                    target.recoveryEpisode,
                    MediaRecoveryEvidence::NetworkFailure, now,
                    target.targetGeneration, true, false);
                if (action != MediaRecoveryAction::ReloadDocument) continue;
                if (target.mediaNetworkRecoveryPending) continue;

                target.mediaNetworkRecoveryAttempt = 0;
                target.mediaNetworkRecoveryPending = true;
                target.mediaNetworkRecoveryTick =
                    now + kSpotifyAudioServiceRecoveryBaseDelayMs +
                    static_cast<ULONGLONG>(lane) *
                        kSpotifyAudioServiceRecoveryLaneSpacingMs;
                target.timedCompletionDeadlineTick = 0;
                target.timedCompletionDeadlineGeneration = 0;
                target.trustedClickBlockedUntilTick = 0;
                SetSlotState(target, SlotState::Recovering);
                target.nextRecoveryTick = target.mediaNetworkRecoveryTick;
                scheduledAny = true;
              }
              if (scheduledAny) {
                RecomputeForeground();
                ArmRobustScheduler();
              }
              return S_OK;
            }

            if (kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED ||
                kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED) {
              // These failures invalidate the playback surface. Rebuilding only
              // this account preserves the other profiles and their rotations.
              const MediaRecoveryAction action = NextMediaRecoveryAction(
                  slot.recoveryEpisode,
                  MediaRecoveryEvidence::ProcessFailure, now,
                  slot.targetGeneration, true, false);
              if (action != MediaRecoveryAction::RebuildSurface) return S_OK;
              slot.mediaPipelineRecoveryGeneration = slot.targetGeneration;
              slot.mediaPipelineRecoveryPending = true;
              SetSlotState(slot, SlotState::Recovering);
              slot.nextRecoveryTick = now;
              ArmRobustScheduler();
              return S_OK;
            }

            if (kind ==
                COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE) {
              ULONGLONG& first =
                  gSpotifyRendererUnresponsiveFirstTicks[accountIndex];
              unsigned& count =
                  gSpotifyRendererUnresponsiveCounts[accountIndex];
              if (first == 0 || now < first ||
                  now - first > kSpotifyRendererUnresponsiveWindowMs) {
                first = now;
                count = 1;
                return S_OK;
              }
              ++count;
              if (count < 2) return S_OK;
              first = 0;
              count = 0;
              const MediaRecoveryAction action = NextMediaRecoveryAction(
                  slot.recoveryEpisode,
                  MediaRecoveryEvidence::ProcessFailure, now,
                  slot.targetGeneration, true, false);
              if (action != MediaRecoveryAction::RebuildSurface) return S_OK;
              slot.mediaPipelineRecoveryGeneration = slot.targetGeneration;
              slot.mediaPipelineRecoveryPending = true;
              SetSlotState(slot, SlotState::Recovering);
              slot.nextRecoveryTick = now;
              ArmRobustScheduler();
              return S_OK;
            }

            // GPU, sandbox-helper, frame-only and non-audio utility processes
            // are auto-recovered by WebView2. Do not turn those transient events
            // into page reloads or WebView rebuild storms.
            return S_OK;
          }).Get(),
      &token);

  if (SUCCEEDED(registered)) {
    gSpotifyProcessFailureRegisteredWebviews[accountIndex] = webview;
  }
}

}  // namespace hp
