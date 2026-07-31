#include "app.h"
#include "sh.h"
#include "sh_audio_loss_policy.h"
#include "web_renderer.h"

namespace hp {
namespace {

bool AudioLossCallbackAlive(const std::shared_ptr<std::atomic<bool>>& alive) {
  return alive && alive->load(std::memory_order_acquire);
}

constexpr wchar_t kAuthenticationUiProbeScript[] = LR"JS(
(() => {
  if (document.readyState === 'loading' || !document.body) return null;
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const selector = [
    'button',
    "[role='button']",
    'a',
    "input[type='button']",
    "input[type='submit']",
    '[aria-label]',
    "[role='dialog']",
    'h1',
    'h2',
    'h3'
  ].join(',');
  const visible = element => {
    if (!element || element.disabled ||
        element.getAttribute?.('aria-disabled') === 'true' ||
        element.getAttribute?.('aria-hidden') === 'true') return false;
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 2 || rect.height <= 2) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      Number(style.opacity || 1) > 0;
  };
  const labelOf = element => [
    element?.innerText,
    element?.getAttribute?.('aria-label'),
    element?.textContent,
    element?.getAttribute?.('title'),
    element?.getAttribute?.('value')
  ].map(normalize).find(Boolean) || '';
  const directAuthentication =
    /^(log\s*in|sign\s*in|login|ログイン|サインイン)(?:\s+.*)?$/i;
  const spotifyAuthentication =
    /(?:connect|continue|authorize|authentication|認証|接続).{0,48}spotify|spotify.{0,48}(?:connect|continue|authorize|authentication|認証|接続)/i;
  for (const element of document.querySelectorAll(selector)) {
    if (!visible(element)) continue;
    const label = labelOf(element);
    if (directAuthentication.test(label) || spotifyAuthentication.test(label)) {
      return true;
    }
  }
  return false;
})()
)JS";

}  // namespace

void App::NotifyStationheadPlaybackFallbackStarted() {
  if (!renderer_ || stationheadPlaybackFallbackActive_) return;
  const NativePlaybackFeedStatus feed =
      renderer_->NativePlaybackFeedStatusFor(0, UnixMillis());
  stationheadPlaybackFallbackActive_ = true;
  stationheadPlaybackNoNextTrackObserved_ = false;
  stationheadPlaybackFallbackRevision_ =
      std::max<uint64_t>(1, feed.healthyRevision);
  if (logger_) {
    logger_->Warn(
        L"Stationhead audio-loss fallback registered; waiting for a newer healthy five-minute playback observation");
  }
}

void StationheadPlayer::UpdateAudioLossState(
    const std::wstring& state, const std::wstring& detail) {
  if (audioLossState_ == state) return;
  audioLossState_ = state;
  {
    std::lock_guard lock(mutex_);
    status_.detail = detail;
  }
  log_.Info(L"Stationhead " + std::wstring(RoleTag()) +
            L" audio-loss state=" + state + L" detail=" + detail);
  PostChange();
}

void StationheadPlayer::ResetAudioLossProbe() noexcept {
  audioLossProbeInFlight_ = false;
  audioLossProbeComplete_ = false;
  audioLossAuthUiDetected_ = false;
}

void StationheadPlayer::BeginAudioLossAuthProbe(int64_t) {
  if (!webview_ || audioLossProbeInFlight_) return;
  const auto alive = createCallbackAlive_;
  ComPtr<ICoreWebView2> view = webview_;
  const int64_t lossStartedAt = audioLossStartedAt_.WallTime();
  audioLossProbeInFlight_ = true;
  const HRESULT started = view->ExecuteScript(
      kAuthenticationUiProbeScript,
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [this, alive, view, lossStartedAt](
              HRESULT result, LPCWSTR resultJson) -> HRESULT {
            if (!AudioLossCallbackAlive(alive) || view.Get() != webview_.Get() ||
                !audioLossProbeInFlight_ ||
                audioLossStartedAt_.WallTime() != lossStartedAt) {
              return S_OK;
            }
            audioLossProbeInFlight_ = false;
            if (FAILED(result) || !resultJson) {
              audioLossProbeComplete_ = false;
              log_.Warn(L"Stationhead " + std::wstring(RoleTag()) +
                        L" authentication UI probe failed; fallback remains blocked");
              RequestImmediateTick();
              return S_OK;
            }
            const std::wstring value(resultJson);
            if (value != L"true" && value != L"false") {
              audioLossProbeComplete_ = false;
              RequestImmediateTick();
              return S_OK;
            }
            audioLossAuthUiDetected_ = value == L"true";
            // Authentication controls can disappear after the user completes a
            // step without navigating. Keep rechecking while they remain visible
            // instead of permanently latching the first positive result.
            audioLossProbeComplete_ = !audioLossAuthUiDetected_;
            if (audioLossAuthUiDetected_) {
              UpdateAudioLossState(
                  L"auth_wait",
                  L"authentication control detected; waiting for user action");
            }
            RequestImmediateTick();
            return S_OK;
          }).Get());
  if (FAILED(started)) {
    audioLossProbeInFlight_ = false;
    audioLossProbeComplete_ = false;
    log_.Warn(L"Stationhead " + std::wstring(RoleTag()) +
              L" authentication UI probe could not start; fallback remains blocked");
  }
}

void StationheadPlayer::SetManagedPlaybackFallback(
    bool active, const std::wstring& reason) {
  const int64_t nowMs = UnixMillis();
  if (active) {
    if (config_.fallbackUrl.empty() || managedPlaybackFallbackActive_) return;
    managedPlaybackFallbackActive_ = true;
    managedPlaybackReturnRequested_ = false;
    managedPrimaryReturnPending_ = false;
    managedPlaybackFallbackStartedAt_ = nowMs;
    audioLossStartedAt_ = 0;
    ResetAudioLossProbe();
    UpdateAudioLossState(L"fallback", reason);
    SetPlaybackFallback(true, reason);
    if (App* app = App::Current()) {
      app->NotifyStationheadPlaybackFallbackStarted();
    }
    return;
  }

  if (!managedPlaybackFallbackActive_) return;
  if (!StationheadFallbackDwellSatisfied(
          nowMs - managedPlaybackFallbackStartedAt_)) {
    managedPlaybackReturnRequested_ = true;
    log_.Info(L"Stationhead " + std::wstring(RoleTag()) +
              L" healthy playback observed; retaining fallback until minimum dwell expires");
    RequestImmediateTick();
    return;
  }

  managedPlaybackFallbackActive_ = false;
  managedPlaybackReturnRequested_ = false;
  managedPrimaryReturnPending_ = true;
  managedPlaybackFallbackStartedAt_ = 0;
  // Treat the attempted return as a playback session that must prove itself.
  // If no audio starts, the same eleven-second recovery path returns to fallback.
  audioLossPlaybackObserved_ = true;
  audioLossStartedAt_ = nowMs;
  ResetAudioLossProbe();
  UpdateAudioLossState(L"returning_primary", reason);
  SetPlaybackFallback(false, reason);
}

void StationheadPlayer::EvaluateAudioLossRecovery(int64_t nowMs) {
  if (managedPlaybackFallbackActive_) {
    if (managedPlaybackReturnRequested_ &&
        StationheadFallbackDwellSatisfied(
            nowMs - managedPlaybackFallbackStartedAt_)) {
      SetManagedPlaybackFallback(
          false,
          L"returning_primary: newer healthy playback JSON observed");
    }
    return;
  }

  const bool audioPlaying = AudioPlaying();
  if (audioPlaying) {
    audioLossPlaybackObserved_ = true;
    audioLossStartedAt_ = 0;
    ResetAudioLossProbe();
    if (managedPrimaryReturnPending_) {
      const int64_t playingSince = AudioPlayingSince();
      if (playingSince > 0 &&
          nowMs - playingSince >= kStationheadPrimaryRecoveryStabilityMs) {
        managedPrimaryReturnPending_ = false;
        UpdateAudioLossState(
            L"playing",
            L"primary audio remained stable after fallback recovery");
      }
    } else if (!audioLossState_.empty() && audioLossState_ != L"playing") {
      UpdateAudioLossState(L"playing", L"audio playing");
    }
    return;
  }

  const StationheadStatus snapshot = Status();
  if (!audioLossPlaybackObserved_) return;
  if (!snapshot.created || snapshot.navigating || snapshot.processFailed ||
      recreating_.load(std::memory_order_acquire) ||
      navigationInFlight_.load(std::memory_order_acquire)) {
    ResetAudioLossProbe();
    return;
  }

  if (audioLossStartedAt_ == 0) {
    audioLossStartedAt_ = nowMs;
    UpdateAudioLossState(
        L"transition_wait",
        L"audio stopped; waiting through the first ten seconds");
    return;
  }
  const int64_t stoppedForMs = nowMs - audioLossStartedAt_;
  if (stoppedForMs < kStationheadAudioLossGraceMs) return;

  if (audioLossState_ == L"transition_wait" || audioLossState_.empty()) {
    ShowAfterAudioStop();
    UpdateAudioLossState(
        L"operation_wait",
        L"operation surface visible; checking authentication controls");
  }
  const bool authenticationPending =
      snapshot.loginRequired || snapshot.spotifyAuthorization;
  if (authenticationPending) {
    ResetAudioLossProbe();
    UpdateAudioLossState(
        L"auth_wait",
        L"authentication is already pending; fallback is blocked");
    return;
  }

  if (!StationheadAudioLossCanProbe(
          audioLossPlaybackObserved_, audioPlaying, snapshot.created,
          snapshot.navigating, snapshot.processFailed,
          authenticationPending, stoppedForMs)) {
    return;
  }
  if (!audioLossProbeComplete_ && !audioLossProbeInFlight_) {
    BeginAudioLossAuthProbe(nowMs);
    return;
  }
  if (StationheadAudioLossCanFallback(
          audioLossProbeComplete_, audioLossAuthUiDetected_, stoppedForMs)) {
    SetManagedPlaybackFallback(
        true,
        L"fallback: no authentication UI remained after the eleventh-second check");
  }
}

}  // namespace hp
