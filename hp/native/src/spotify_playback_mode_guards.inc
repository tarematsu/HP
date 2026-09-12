namespace hp {
namespace {

constexpr wchar_t kSpotifyPlaybackModesOffProbeScript[] = LR"JS(
(() => {
  const inspect = (testId, activeStates) => {
    const button = document.querySelector(`button[data-testid="${testId}"]`);
    if (!button) return { off: false, point: null };
    const checked = button.getAttribute('aria-checked');
    if (checked === 'false') return { off: true, point: null };
    if (!activeStates.includes(checked)) return { off: false, point: null };
    const style = window.getComputedStyle(button);
    const rect = button.getBoundingClientRect();
    if (button.disabled || button.getAttribute('aria-disabled') === 'true' ||
        style.display === 'none' || style.visibility === 'hidden' ||
        style.pointerEvents === 'none' || rect.width <= 0 || rect.height <= 0 ||
        window.innerWidth <= 0 || window.innerHeight <= 0) {
      return { off: false, point: null };
    }
    return {
      off: false,
      point: [
        Math.max(0, Math.min(10000, Math.round(
            ((rect.left + rect.width / 2) / window.innerWidth) * 10000))),
        Math.max(0, Math.min(10000, Math.round(
            ((rect.top + rect.height / 2) / window.innerHeight) * 10000)))
      ]
    };
  };

  const shuffle = inspect('control-button-shuffle', ['true']);
  const repeat = inspect('control-button-repeat', ['true', 'mixed']);
  if (shuffle.point) return shuffle.point;
  if (repeat.point) return repeat.point;
  return shuffle.off && repeat.off;
})()
)JS";

}  // namespace

bool SpotifyWebViews::EnsurePlaybackModeOff(
    Slot& slot, PlaybackModeGuard mode) noexcept {
  const bool requestedVerified = mode == PlaybackModeGuard::Shuffle
      ? slot.shuffleOffVerified
      : slot.repeatOffVerified;
  if (requestedVerified) return true;
  if (!slot.webview || slot.reconcileInFlight) return false;

  ++slot.reconcileRequestGeneration;
  if (slot.reconcileRequestGeneration == 0) ++slot.reconcileRequestGeneration;
  const ULONGLONG requestGeneration = slot.reconcileRequestGeneration;
  const ULONGLONG requestedGeneration = slot.targetGeneration;
  slot.reconcileInFlight = true;
  slot.reconcileStartedTick = GetTickCount64();

  Slot* const target = &slot;
  ComPtr<ICoreWebView2> requestedView = slot.webview;
  const auto alive = alive_;
  const HRESULT started = requestedView->ExecuteScript(
      kSpotifyPlaybackModesOffProbeScript,
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [this, alive, target, requestedView, requestedGeneration,
           requestGeneration](HRESULT result, LPCWSTR json) -> HRESULT {
            if (!alive->load(std::memory_order_acquire)) return S_OK;
            if (target->reconcileRequestGeneration != requestGeneration ||
                target->webview.Get() != requestedView.Get()) {
              return S_OK;
            }
            target->reconcileInFlight = false;
            target->reconcileStartedTick = 0;
            if (!started_ || requestedGeneration != target->targetGeneration ||
                !ResolveMusicTarget(*target).url) {
              return S_OK;
            }

            if (SUCCEEDED(result) && json) {
              const std::wstring_view value(json);
              if (value == L"true") {
                target->shuffleOffVerified = true;
                target->repeatOffVerified = true;
                ArmRobustScheduler();
                return S_OK;
              }
              // Missing or not-yet-mounted controls remain pending. Playback is
              // already confirmed at this stage, so mode convergence must never
              // demote a healthy slot or block the media clock.
              if (value == L"false") {
                ArmRobustScheduler();
                return S_OK;
              }
            }

            int x = 0;
            int y = 0;
            if (SUCCEEDED(result) && ParseNormalizedPoint(json, &x, &y)) {
              // The point was measured in the current viewport and belongs only
              // to Shuffle/Repeat. Dispatch it directly so changing a playback
              // mode cannot route through the recovery click helper and change
              // SlotState::Playing to WaitingTarget.
              DispatchSpotifyDevToolsClick(*target, x, y);
              ArmRobustScheduler();
              return S_OK;
            }

            // Shuffle/Repeat are post-start best-effort guards. Script failures
            // must not convert a genuinely playing slot into recovery; retry on
            // a later healthy verification turn instead.
            ArmRobustScheduler();
            return S_OK;
          }).Get());

  if (FAILED(started)) {
    if (slot.reconcileRequestGeneration == requestGeneration &&
        slot.webview.Get() == requestedView.Get()) {
      slot.reconcileInFlight = false;
      slot.reconcileStartedTick = 0;
    }
    ArmRobustScheduler();
  }
  return false;
}

}  // namespace hp
