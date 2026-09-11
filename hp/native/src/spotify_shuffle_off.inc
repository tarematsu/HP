namespace hp {
namespace {

constexpr wchar_t kSpotifyShuffleOffProbeScript[] = LR"JS(
(() => {
  const button = document.querySelector(
      'button[data-testid="control-button-shuffle"]');
  if (!button || button.getAttribute('aria-checked') !== 'true') return true;
  const style = window.getComputedStyle(button);
  const rect = button.getBoundingClientRect();
  if (button.disabled || button.getAttribute('aria-disabled') === 'true' ||
      style.display === 'none' || style.visibility === 'hidden' ||
      style.pointerEvents === 'none' || rect.width <= 0 || rect.height <= 0 ||
      window.innerWidth <= 0 || window.innerHeight <= 0) {
    return null;
  }
  return [
    Math.max(0, Math.min(10000, Math.round(
        ((rect.left + rect.width / 2) / window.innerWidth) * 10000))),
    Math.max(0, Math.min(10000, Math.round(
        ((rect.top + rect.height / 2) / window.innerHeight) * 10000)))
  ];
})()
)JS";

}  // namespace

bool SpotifyWebViews::EnsureShuffleOff(Slot& slot) noexcept {
  if (slot.shuffleOffVerified) return true;
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
      kSpotifyShuffleOffProbeScript,
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

            if (SUCCEEDED(result) && json &&
                std::wstring_view(json) == L"true") {
              target->shuffleOffVerified = true;
              ArmRobustScheduler();
              return S_OK;
            }

            int x = 0;
            int y = 0;
            if (SUCCEEDED(result) && ParseNormalizedPoint(json, &x, &y)) {
              ClickSlotNormalizedPoint(*target, x, y);
              ArmRobustScheduler();
              return S_OK;
            }

            MarkSlotRecovering(*target, GetTickCount64());
            RecomputeForeground();
            ArmRobustScheduler();
            return S_OK;
          }).Get());

  if (FAILED(started)) {
    if (slot.reconcileRequestGeneration == requestGeneration &&
        slot.webview.Get() == requestedView.Get()) {
      slot.reconcileInFlight = false;
      slot.reconcileStartedTick = 0;
    }
    MarkSlotRecovering(slot, GetTickCount64());
    RecomputeForeground();
    ArmRobustScheduler();
  }
  return false;
}

}  // namespace hp
