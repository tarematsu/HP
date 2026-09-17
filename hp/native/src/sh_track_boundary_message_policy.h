#pragma once
#include "common.h"
#include "audio_health_scan_coordinator.h"
#include "sh_audio_loss_policy.h"

namespace hp {

inline constexpr bool StationheadPlaybackNavigationActive(
    bool navigationInFlight,
    bool statusNavigating,
    bool spotifyAuthorization) noexcept {
  return navigationInFlight || (statusNavigating && !spotifyAuthorization);
}

inline constexpr int64_t StationheadPeriodicRefreshIntervalMs() noexcept {
  return 50 * 60'000;
}

inline constexpr bool StationheadPeriodicRefreshNeedsNavigation(
    bool audioPlaying,
    bool playbackObserved,
    bool audioLossActive,
    int64_t stoppedForMs) noexcept {
  return !audioPlaying && playbackObserved && audioLossActive &&
      stoppedForMs >=
          kStationheadAudioLossGraceMs + kStationheadAudioLossDomSettleMs;
}

inline constexpr int64_t StationheadAudioHealthCheckIntervalMs() noexcept {
  return 1 * 60'000;
}

inline constexpr int64_t StationheadAudioEscalationSettleMs() noexcept {
  return 15'000;
}

inline void RestoreStationheadPlaybackMemoryTargetForReload(
    ICoreWebView2* webview) noexcept {
  if (!webview) return;
  ComPtr<ICoreWebView2> baseWebView = webview;
  ComPtr<ICoreWebView2_19> webview19;
  if (FAILED(baseWebView.As(&webview19)) || !webview19) return;

  COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL current =
      COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL;
  if (SUCCEEDED(webview19->get_MemoryUsageTargetLevel(&current)) &&
      current == COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL) {
    return;
  }
  webview19->put_MemoryUsageTargetLevel(
      COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL);
}

static_assert(StationheadPlaybackNavigationActive(true, false, false));
static_assert(StationheadPlaybackNavigationActive(true, true, true));
static_assert(StationheadPlaybackNavigationActive(false, true, false));
static_assert(!StationheadPlaybackNavigationActive(false, true, true));
static_assert(!StationheadPlaybackNavigationActive(false, false, false));
static_assert(StationheadPeriodicRefreshIntervalMs() == 50 * 60'000);
static_assert(!StationheadPeriodicRefreshNeedsNavigation(
    true, true, true, 60'000));
static_assert(!StationheadPeriodicRefreshNeedsNavigation(
    false, true, true, 59'999));
static_assert(!StationheadPeriodicRefreshNeedsNavigation(
    false, false, true, 60'000));
static_assert(StationheadPeriodicRefreshNeedsNavigation(
    false, true, true, 60'000));
static_assert(StationheadAudioHealthCheckIntervalMs() == 1 * 60'000);
static_assert(StationheadAudioEscalationSettleMs() == 15'000);

}  // namespace hp

// Extend StationheadPlayer while sh.h is parsed, then remove the temporary
// source-rewriting macros before any implementation file is compiled. The
// single Stationhead player audits playback every 50 minutes and reloads only
// after confirmed persistent audio loss. Native audio is polled independently
// once per minute in shared scan slot 0.
#define NextWakeAt()                                                          \
  NextWakeAt() const noexcept {                                               \
    int64_t next = NextWakeAtBase();                                          \
    if (periodicRefreshStartedAt_.Active()) {                                 \
      const int64_t due = periodicRefreshStartedAt_ +                         \
          ::hp::StationheadPeriodicRefreshIntervalMs();                       \
      if (next <= 0 || due < next) next = due;                                \
    }                                                                         \
    if (audioHealthCheckStartedAt_.Active()) {                                \
      const int64_t due = audioHealthCheckStartedAt_ +                        \
          ::hp::StationheadAudioHealthCheckIntervalMs();                      \
      if (next <= 0 || due < next) next = due;                                \
    }                                                                         \
    if (audioLossEscalationStartedAt_.Active()) {                             \
      const int64_t due = audioLossEscalationStartedAt_ +                     \
          ::hp::StationheadAudioEscalationSettleMs();                         \
      if (next <= 0 || due < next) next = due;                                \
    }                                                                         \
    return next;                                                              \
  }                                                                           \
  [[nodiscard]] int64_t NextWakeAtBase()

#define RecoverUnavailableAuthorization()                                    \
  RecoverUnavailableAuthorization() {                                        \
    RecoverUnavailableAuthorizationBase();                                   \
    const int64_t nowMs = UnixMillis();                                       \
    EscalateAudioLossRecovery(nowMs);                                         \
    PollPeriodicAudioHealth(nowMs);                                           \
    RefreshPeriodicNavigation(nowMs);                                         \
  }                                                                           \
  void RecoverUnavailableAuthorizationBase()

#define RetryPendingTrackBoundaryRefresh(parameters)                         \
  RetryPendingTrackBoundaryRefresh(parameters) {                             \
    (void)nowMs;                                                              \
    trackBoundaryRefreshPending_ = false;                                     \
    return false;                                                             \
  }                                                                           \
  bool RetryPendingTrackBoundaryRefreshDisabled(parameters)

#define nextAutoClickAt_                                                      \
  nextAutoClickAt_ = 0;                                                       \
  void ResetAudioLossEscalation() noexcept {                                  \
    ::hp::ObserveMediaRecoveryHealthy(                                       \
        mediaRecoveryEpisode_, GetTickCount64(), 1);                         \
    if (mediaRecoveryEpisode_.highestAction !=                               \
        ::hp::MediaRecoveryAction::None) {                                   \
      return;                                                                \
    }                                                                         \
    audioLossEscalationStage_ = 0;                                            \
    audioLossEscalationAwaitingNavigation_ = false;                           \
    audioLossEscalationStartedAt_ = 0;                                        \
    audioLossEscalationLifecycle_.reset();                                    \
  }                                                                           \
  void EscalateAudioLossRecovery(int64_t nowMs) {                             \
    if (audioPlaying_.load(std::memory_order_relaxed)) {                      \
      ResetAudioLossEscalation();                                             \
      return;                                                                 \
    }                                                                         \
    if (!webview_ || usingFallback_ || managedPlaybackFallbackActive_ ||      \
        spotifyAuthorization_ || loginRequired_) {                            \
      return;                                                                 \
    }                                                                         \
                                                                                \
    bool statusNavigating = false;                                            \
    {                                                                         \
      std::lock_guard lock(mutex_);                                           \
      statusNavigating = status_.navigating;                                  \
    }                                                                         \
    const bool navigationActive =                                             \
        ::hp::StationheadPlaybackNavigationActive(                            \
            navigationInFlight_.load(std::memory_order_acquire),              \
            statusNavigating, spotifyAuthorization_);                         \
                                                                                \
    if (audioLossEscalationStage_ == 0) {                                     \
      if (navigationActive || recreating_.load(std::memory_order_relaxed) ||  \
          !audioLossPlaybackObserved_ || !audioLossStartedAt_.Active() ||     \
          audioLossStartedAt_.ElapsedMilliseconds() <                         \
              (::hp::kStationheadAudioLossGraceMs +                           \
               ::hp::kStationheadAudioLossDomSettleMs) ||                     \
          audioLossProbeInFlight_ || !audioLossProbeComplete_ ||              \
          audioLossAuthUiDetected_) {                                         \
        return;                                                               \
      }                                                                       \
      const auto action = ::hp::NextMediaRecoveryAction(                     \
          mediaRecoveryEpisode_, ::hp::MediaRecoveryEvidence::ConfirmedSilence, \
          GetTickCount64(), 1, true, !config_.fallbackUrl.empty());          \
      if (action != ::hp::MediaRecoveryAction::ReloadDocument) return;       \
                                                                                \
      audioLossEscalationStage_ = 1;                                          \
      audioLossEscalationAwaitingNavigation_ = true;                          \
      audioLossEscalationStartedAt_ = 0;                                      \
      audioLossStartedAt_ = 0;                                                \
      ResetAudioLossProbe();                                                  \
      nextAutoClickAt_ = nowMs;                                               \
      UpdateAudioLossState(                                                   \
          L"reload_recovery",                                                \
          L"silence survived Start Listening/media repair; reloading Stationhead page"); \
      NavigateCurrentUrl(nowMs, L"audio-loss recovery reload");              \
      return;                                                                 \
    }                                                                         \
                                                                                \
    if (audioLossEscalationStage_ == 1) {                                     \
      if (navigationActive || recreating_.load(std::memory_order_relaxed)) {  \
        return;                                                               \
      }                                                                       \
      if (audioLossEscalationAwaitingNavigation_) {                           \
        audioLossEscalationAwaitingNavigation_ = false;                       \
        audioLossEscalationStartedAt_ = nowMs;                                \
        nextAutoClickAt_ = nowMs;                                             \
        AttemptNativeStartClick(nowMs);                                       \
        UpdateAudioLossState(                                                 \
            L"reload_settle",                                                \
            L"Stationhead page reloaded; waiting for automatic Start Listening recovery"); \
        return;                                                               \
      }                                                                       \
      if (!audioLossEscalationStartedAt_.Active() ||                          \
          audioLossEscalationStartedAt_.ElapsedMilliseconds() <               \
              ::hp::StationheadAudioEscalationSettleMs()) {                   \
        return;                                                               \
      }                                                                       \
      const auto action = ::hp::NextMediaRecoveryAction(                     \
          mediaRecoveryEpisode_, ::hp::MediaRecoveryEvidence::ConfirmedSilence, \
          GetTickCount64(), 1, true, !config_.fallbackUrl.empty());          \
      if (action != ::hp::MediaRecoveryAction::RebuildSurface) return;       \
                                                                                \
      audioLossEscalationStage_ = 2;                                          \
      audioLossEscalationStartedAt_ = 0;                                      \
      audioLossEscalationLifecycle_ = createCallbackAlive_;                   \
      audioLossStartedAt_ = 0;                                                \
      ResetAudioLossProbe();                                                  \
      UpdateAudioLossState(                                                   \
          L"webview_recovery",                                               \
          L"audio still silent after page reload; rebuilding Stationhead WebView2 session"); \
      ScheduleRecreate(                                                       \
          L"audio still silent after page reload; rebuilding playback WebView", \
          1'000);                                                             \
      return;                                                                 \
    }                                                                         \
                                                                                \
    if (audioLossEscalationStage_ == 2) {                                     \
      if (navigationActive || recreating_.load(std::memory_order_relaxed)) {  \
        return;                                                               \
      }                                                                       \
      const auto previousLifecycle = audioLossEscalationLifecycle_.lock();    \
      if (previousLifecycle != createCallbackAlive_) {                        \
        audioLossEscalationLifecycle_ = createCallbackAlive_;                 \
        audioLossEscalationStartedAt_ = nowMs;                                \
        nextAutoClickAt_ = nowMs;                                             \
        AttemptNativeStartClick(nowMs);                                       \
        UpdateAudioLossState(                                                 \
            L"webview_settle",                                               \
            L"Stationhead WebView rebuilt; waiting for automatic playback recovery"); \
        return;                                                               \
      }                                                                       \
      if (!audioLossEscalationStartedAt_.Active() ||                          \
          audioLossEscalationStartedAt_.ElapsedMilliseconds() <               \
              ::hp::StationheadAudioEscalationSettleMs()) {                   \
        return;                                                               \
      }                                                                       \
      if (audioLossProbeInFlight_) return;                                    \
      if (!audioLossProbeComplete_) {                                         \
        BeginAudioLossAuthProbe(nowMs);                                       \
        return;                                                               \
      }                                                                       \
      if (audioLossAuthUiDetected_ || loginRequired_) return;                 \
      const auto action = ::hp::NextMediaRecoveryAction(                     \
          mediaRecoveryEpisode_, ::hp::MediaRecoveryEvidence::ConfirmedSilence, \
          GetTickCount64(), 1, true, !config_.fallbackUrl.empty());          \
      if (action != ::hp::MediaRecoveryAction::UseFallback) return;          \
                                                                                \
      audioLossEscalationStage_ = 3;                                          \
      UpdateAudioLossState(                                                   \
          L"fallback_after_rebuild",                                         \
          L"WebView rebuild remained silent; switching to managed playback fallback"); \
      SetManagedPlaybackFallback(                                             \
          true,                                                               \
          L"fallback: Stationhead remained silent after page reload and WebView rebuild"); \
    }                                                                         \
  }                                                                           \
  void PollPeriodicAudioHealth(int64_t nowMs) {                               \
    const auto lifecycle = createCallbackAlive_;                              \
    const auto previousLifecycle = audioHealthLifecycle_.lock();              \
    if (!webview_ || previousLifecycle != lifecycle) {                        \
      audioHealthLifecycle_ = lifecycle;                                      \
      audioHealthCheckStartedAt_ = 0;                                         \
      if (!webview_) return;                                                  \
    }                                                                         \
                                                                                \
    bool statusNavigating = false;                                            \
    {                                                                         \
      std::lock_guard lock(mutex_);                                           \
      statusNavigating = status_.navigating;                                  \
    }                                                                         \
    const bool navigationActive =                                             \
        ::hp::StationheadPlaybackNavigationActive(                            \
            navigationInFlight_.load(std::memory_order_acquire),              \
            statusNavigating, spotifyAuthorization_);                         \
    if (!webViewConfigured_ || !startupNavigationStarted_ ||                  \
        spotifyAuthorization_ || loginRequired_ || navigationActive ||        \
        recreating_.load(std::memory_order_relaxed)) {                        \
      audioHealthCheckStartedAt_ = 0;                                         \
      return;                                                                 \
    }                                                                         \
                                                                                \
    const int64_t intervalMs =                                                \
        ::hp::StationheadAudioHealthCheckIntervalMs();                        \
    const auto scheduleAfter = [&](ULONGLONG delayMs) {                       \
      const int64_t boundedDelay = static_cast<int64_t>(                      \
          std::min<ULONGLONG>(delayMs, static_cast<ULONGLONG>(intervalMs)));  \
      audioHealthCheckStartedAt_ = nowMs - (intervalMs - boundedDelay);       \
    };                                                                        \
    if (!audioHealthCheckStartedAt_.Active()) {                               \
      scheduleAfter(::hp::AudioHealthScanDelayMs(GetTickCount64(), 0));       \
      return;                                                                 \
    }                                                                         \
    if (nowMs - audioHealthCheckStartedAt_ < intervalMs) return;              \
                                                                                \
    const ULONGLONG scanTick = GetTickCount64();                              \
    if (!::hp::TryClaimAudioHealthScan(scanTick)) {                           \
      scheduleAfter(::hp::kAudioHealthScanRetryMs);                           \
      return;                                                                 \
    }                                                                         \
                                                                                \
    ComPtr<ICoreWebView2_8> audioView;                                        \
    BOOL nativePlaying = FALSE;                                               \
    const HRESULT audioInterfaceResult = webview_.As(&audioView);             \
    const HRESULT audioStateResult =                                          \
        SUCCEEDED(audioInterfaceResult) && audioView                          \
            ? audioView->get_IsDocumentPlayingAudio(&nativePlaying)           \
            : E_NOINTERFACE;                                                  \
    ::hp::ReleaseAudioHealthScan();                                           \
    if (FAILED(audioInterfaceResult) || !audioView ||                         \
        FAILED(audioStateResult)) {                                           \
      scheduleAfter(::hp::kAudioHealthScanRetryMs);                           \
      return;                                                                 \
    }                                                                         \
                                                                                \
    scheduleAfter(::hp::AudioHealthScanDelayMs(scanTick, 0));                 \
    const bool playing = nativePlaying != FALSE;                              \
    ApplyAudioPlaybackState(playing, L"1-minute native audio health check");  \
    if (playing) return;                                                      \
                                                                                \
    static constexpr wchar_t kPeriodicAudioRecoveryScript[] = LR"JS(          \
(() => {                                                                      \
  try { window.__homepanelPrimaryStationhead?.scan?.(0); } catch (_) {}       \
  for (const media of document.querySelectorAll('audio,video')) {             \
    if (!media || media.ended || media.readyState < 2) continue;              \
    try {                                                                     \
      if (media.paused) {                                                     \
        const result = media.play?.();                                        \
        if (result?.catch) result.catch(() => {});                            \
      }                                                                       \
    } catch (_) {}                                                            \
  }                                                                           \
  return true;                                                                \
})()                                                                          \
)JS";                                                                         \
    webview_->ExecuteScript(kPeriodicAudioRecoveryScript, nullptr);           \
    nextAutoClickAt_ = nowMs;                                                 \
    AttemptNativeStartClick(nowMs);                                           \
  }                                                                           \
  void RefreshPeriodicNavigation(int64_t nowMs) {                             \
    const auto lifecycle = createCallbackAlive_;                              \
    const auto previousLifecycle = periodicRefreshLifecycle_.lock();          \
    if (!webview_ || previousLifecycle != lifecycle) {                        \
      periodicRefreshLifecycle_ = lifecycle;                                  \
      periodicRefreshStartedAt_ = 0;                                         \
      periodicRefreshNavigationObserved_ = 0;                                 \
      if (!webview_) return;                                                  \
    }                                                                         \
                                                                                \
    bool statusNavigating = false;                                            \
    {                                                                         \
      std::lock_guard lock(mutex_);                                           \
      statusNavigating = status_.navigating;                                  \
    }                                                                         \
    const bool navigationActive =                                             \
        ::hp::StationheadPlaybackNavigationActive(                            \
            navigationInFlight_.load(std::memory_order_acquire),              \
            statusNavigating, spotifyAuthorization_);                         \
    if (navigationActive) {                                                   \
      periodicRefreshStartedAt_ = 0;                                         \
      periodicRefreshNavigationObserved_ = 1;                                 \
      return;                                                                 \
    }                                                                         \
                                                                                \
    if (!webViewConfigured_ || !startupNavigationStarted_ ||                  \
        spotifyAuthorization_ || loginRequired_ ||                            \
        recreating_.load(std::memory_order_relaxed)) {                        \
      return;                                                                 \
    }                                                                         \
                                                                                \
    if (periodicRefreshNavigationObserved_ != 0 ||                            \
        !periodicRefreshStartedAt_.Active()) {                                \
      periodicRefreshNavigationObserved_ = 0;                                 \
      periodicRefreshStartedAt_ = nowMs;                                      \
      return;                                                                 \
    }                                                                         \
    const int64_t intervalMs =                                                \
        ::hp::StationheadPeriodicRefreshIntervalMs();                         \
    if (nowMs - periodicRefreshStartedAt_ < intervalMs) return;               \
                                                                                \
    const bool audioLossActive = audioLossStartedAt_.Active();                \
    const int64_t stoppedForMs = audioLossActive                              \
        ? audioLossStartedAt_.ElapsedMilliseconds()                           \
        : 0;                                                                  \
    if (!::hp::StationheadPeriodicRefreshNeedsNavigation(                     \
            audioPlaying_.load(std::memory_order_relaxed),                    \
            audioLossPlaybackObserved_, audioLossActive, stoppedForMs)) {     \
      periodicRefreshStartedAt_ = nowMs;                                      \
      periodicRefreshNavigationObserved_ = 0;                                 \
      return;                                                                 \
    }                                                                         \
                                                                                \
    periodicRefreshStartedAt_ = nowMs;                                        \
    audioPlayingSinceAt_.store(0, std::memory_order_relaxed);                 \
    audioLossPlaybackObserved_ = false;                                       \
    ::hp::RestoreStationheadPlaybackMemoryTargetForReload(webview_.Get());    \
    SetStartupBounds();                                                       \
    NavigateCurrentUrl(nowMs, L"50-minute periodic refresh");                \
  }                                                                           \
  int audioLossEscalationStage_ = 0;                                          \
  bool audioLossEscalationAwaitingNavigation_ = false;                        \
  MonotonicElapsedTimestamp audioLossEscalationStartedAt_;                    \
  std::weak_ptr<std::atomic<bool>> audioLossEscalationLifecycle_;             \
  MonotonicElapsedTimestamp audioHealthCheckStartedAt_;                       \
  std::weak_ptr<std::atomic<bool>> audioHealthLifecycle_;                     \
  MonotonicElapsedTimestamp periodicRefreshStartedAt_;                        \
  std::weak_ptr<std::atomic<bool>> periodicRefreshLifecycle_;                 \
  int64_t periodicRefreshNavigationObserved_

#include "sh.h"
