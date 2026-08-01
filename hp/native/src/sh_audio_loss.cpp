#include "app.h"
#include "sh.h"
#include "sh_audio_loss_policy.h"
#include "web_renderer.h"
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {

bool AudioLossCallbackAlive(const std::shared_ptr<std::atomic<bool>>& alive) {
  return alive && alive->load(std::memory_order_acquire);
}

// This probe is based on the live Stationhead DOM observed on 2026-07-31.
// The ordinary page has a persistent top-right `Log in` button. That button by
// itself is not evidence that playback recovery requires authentication. The
// music authorization surface is a modal headed `Connect music`; its `Spotify`
// label and `Connect` button are separate descendants, so a per-element word
// search cannot identify it correctly.
constexpr wchar_t kAuthenticationUiProbeScript[] = LR"JS(
(() => {
  if (document.readyState === 'loading' || !document.body) return null;
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const labelsOf = element => [
    element?.innerText,
    element?.textContent,
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('title'),
    element?.getAttribute?.('value'),
    element?.getAttribute?.('placeholder')
  ].map(normalize).filter(Boolean);
  const visible = element => {
    if (!element || element.getAttribute?.('aria-hidden') === 'true') return false;
    if (typeof element.checkVisibility === 'function') {
      try {
        if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
          return false;
        }
      } catch (_) {}
    }
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 2 || rect.height <= 2) return false;
    for (let node = element; node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' ||
          Number(style.opacity || 1) <= 0) return false;
    }
    return true;
  };
  const actionableSelector =
    "button,[role='button'],a,input[type='button'],input[type='submit']";
  const actionable = [...document.querySelectorAll(actionableSelector)].filter(visible);
  const labelMatches = (element, pattern) => labelsOf(element).some(label => pattern.test(label));
  const summary = (reason, evidence) => ({
    ready: true,
    authentication: true,
    reason,
    evidence: evidence.map(normalize).filter(Boolean).slice(0, 6)
  });

  // The live service selector has no role=dialog. Locate the `Connect music`
  // heading, then require a common visible ancestor that contains a service
  // name and a Connect control. A disabled Connect control remains visible
  // authentication evidence while Stationhead waits for service selection.
  const connectHeading = [...document.querySelectorAll('h1,h2,h3,[role="heading"]')]
    .filter(visible)
    .find(element => labelsOf(element).some(label => /^connect\s+music$/i.test(label)));
  if (connectHeading) {
    for (let surface = connectHeading.parentElement, depth = 0;
         surface && depth < 9;
         surface = surface.parentElement, depth += 1) {
      if (!visible(surface)) continue;
      const surfaceText = normalize(surface.innerText || surface.textContent);
      const hasService = /\bspotify\b|\bapple\s+music\b/i.test(surfaceText);
      const hasConnect = [...surface.querySelectorAll(actionableSelector)]
        .filter(visible)
        .some(element => labelsOf(element).some(label => /^connect(?:\s+.*)?$/i.test(label)));
      if (hasService && hasConnect) {
        const evidence = ['Connect music'];
        if (/\bspotify\b/i.test(surfaceText)) evidence.push('Spotify');
        if (/\bapple\s+music\b/i.test(surfaceText)) evidence.push('Apple Music');
        evidence.push('Connect');
        return summary('music-service-connect', evidence);
      }
    }
  }

  const isCredentialInput = element => {
    const type = normalize(element.getAttribute('type')).toLowerCase();
    const autocomplete = normalize(element.getAttribute('autocomplete')).toLowerCase();
    const identity = labelsOf(element).join(' ').toLowerCase() + ' ' +
      normalize(element.getAttribute('name')).toLowerCase() + ' ' +
      normalize(element.id).toLowerCase();
    return type === 'email' || type === 'password' || type === 'tel' ||
      /email|username|current-password|tel/.test(autocomplete) ||
      /email|phone|user|login|password/.test(identity);
  };
  const loginInput = [...document.querySelectorAll('input')]
    .filter(visible)
    .find(isCredentialInput);
  if (loginInput) {
    return summary('stationhead-login-form', labelsOf(loginInput));
  }

  // A standalone `Log in` header button is present on the ordinary listening
  // page and must not block fallback. Treat a login heading as authentication
  // only when its visible container also carries login-specific controls.
  const loginHeadingPattern =
    /^(log\s*in|sign\s*in|login|ログイン|サインイン)(?:\s+.*)?$/i;
  const loginHeading = [...document.querySelectorAll('h1,h2,h3,[role="heading"]')]
    .filter(visible)
    .find(element => labelMatches(element, loginHeadingPattern));
  if (loginHeading) {
    const loginActionPattern = /^(use\s+phone\s+instead|forgot\s+password\??|continue\s+with\s+(?:apple|twitter|google)|電話番号を使用|パスワードを忘れた)/i;
    for (let surface = loginHeading.parentElement, depth = 0;
         surface && depth < 9;
         surface = surface.parentElement, depth += 1) {
      if (!visible(surface)) continue;
      const credentialInput = [...surface.querySelectorAll('input')]
        .filter(visible)
        .find(isCredentialInput);
      const authAction = [...surface.querySelectorAll(actionableSelector)]
        .filter(visible)
        .find(element => labelMatches(element, loginActionPattern));
      if (credentialInput || authAction) {
        return summary(
          'stationhead-login-form',
          ['Log in', ...labelsOf(credentialInput), ...labelsOf(authAction)]
        );
      }
    }
  }

  return {
    ready: true,
    authentication: false,
    reason: 'none',
    evidence: []
  };
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
            if (FAILED(result) || !resultJson || std::wstring_view(resultJson) == L"null") {
              audioLossProbeComplete_ = false;
              log_.Warn(L"Stationhead " + std::wstring(RoleTag()) +
                        L" authentication UI probe failed; fallback remains blocked");
              return S_OK;
            }

            try {
              const auto probe =
                  winrt::Windows::Data::Json::JsonObject::Parse(resultJson);
              if (!probe.GetNamedBoolean(L"ready", false)) {
                audioLossProbeComplete_ = false;
                return S_OK;
              }
              const bool authentication =
                  probe.GetNamedBoolean(L"authentication", false);
              const std::wstring reason =
                  probe.GetNamedString(L"reason", L"unknown").c_str();
              audioLossAuthUiDetected_ = authentication;
              // Positive observations are deliberately not latched. The UI is
              // re-probed on the next foreground tick, so completing a login or
              // music-service connection without navigation can continue to
              // fallback once the blocking surface disappears.
              audioLossProbeComplete_ = !authentication;
              if (authentication) {
                UpdateAudioLossState(
                    L"auth_wait",
                    L"authentication surface detected (" + reason +
                        L"); waiting for user action");
              } else {
                RequestImmediateTick();
                PostChange();
              }
            } catch (...) {
              audioLossProbeComplete_ = false;
              log_.Warn(L"Stationhead " + std::wstring(RoleTag()) +
                        L" authentication UI probe returned an invalid result");
            }
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
  // Navigation time is not audio-loss time. Start a fresh eleven-second
  // confirmation window only after the primary document has finished loading.
  audioLossPlaybackObserved_ = true;
  audioLossStartedAt_ = 0;
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

  const StationheadStatus snapshot = Status();
  const bool navigationActive =
      !snapshot.created || snapshot.navigating || snapshot.processFailed ||
      recreating_.load(std::memory_order_acquire) ||
      navigationInFlight_.load(std::memory_order_acquire);
  if (navigationActive) {
    // Initial navigation and later page rebuilds can emit a brief native audio
    // pulse before the actual stream is ready. Never arm fallback from that
    // transient signal. A normal primary navigation must establish continuous
    // audio again; the managed fallback return path retains its dedicated
    // two-second recovery confirmation.
    if (!managedPrimaryReturnPending_) audioLossPlaybackObserved_ = false;
    audioLossStartedAt_ = 0;
    ResetAudioLossProbe();
    return;
  }

  const bool audioPlaying = AudioPlaying();
  if (audioPlaying) {
    const int64_t playingSince = AudioPlayingSince();
    const int64_t playingForMs = playingSince > 0 && nowMs >= playingSince
        ? nowMs - playingSince
        : 0;
    audioLossStartedAt_ = 0;
    ResetAudioLossProbe();

    if (!audioLossPlaybackObserved_ && !managedPrimaryReturnPending_) {
      if (!StationheadAudioLossCanArm(
              true, navigationActive, playingForMs)) {
        UpdateAudioLossState(
            L"startup_wait",
            L"audio detected during startup; waiting for fifteen seconds of continuous playback before arming fallback");
        return;
      }
      audioLossPlaybackObserved_ = true;
      UpdateAudioLossState(
          L"playing",
          L"continuous primary audio confirmed; audio-loss fallback armed");
    }

    if (managedPrimaryReturnPending_) {
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

  if (!audioLossPlaybackObserved_) return;

  if (audioLossStartedAt_ == 0) {
    audioLossStartedAt_ = nowMs;
    UpdateAudioLossState(
        L"transition_wait",
        L"audio stopped; waiting through seconds zero to ten");
    return;
  }
  const int64_t stoppedForMs = nowMs - audioLossStartedAt_;
  if (stoppedForMs < kStationheadAudioLossGraceMs) return;

  if (audioLossState_ == L"transition_wait" || audioLossState_.empty() ||
      audioLossState_ == L"returning_primary") {
    ShowAfterAudioStop();
    UpdateAudioLossState(
        L"operation_wait",
        L"operation surface visible after eleven seconds; checking authentication UI");
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
        L"fallback: no authentication surface remained at the twelve-second check");
  }
}

}  // namespace hp
