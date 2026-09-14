#pragma once

namespace hp {

// Bounded blank-page recovery for the single Stationhead document runtime.
// This fragment owns only the two one-shot timers and reload cooldown; it does
// not install recurring polling or its own lifecycle observers.
inline std::wstring_view StationheadRuntimeBlankRecoveryFragment() noexcept {
  static constexpr std::wstring_view kFragment = LR"JS(
  let blankTimer = 0;
  let blankConfirmTimer = 0;
  const blankReloadKey = '__homepanelStationheadCompactBlankReloadAt';

  const sparseBlankPage = () => {
    if (!pageActive || document.readyState !== 'complete' || !document.body ||
        playing() || blockingLogin(accountVisible())) return false;
    if (normalize(document.body.innerText).length >= 48) return false;
    return !document.querySelector(
      "button,a,input,select,textarea,audio,video,[role='button'],[aria-label]");
  };
  const armBlankRecovery = () => {
    if (blankTimer) nativeClearTimeout(blankTimer);
    if (blankConfirmTimer) nativeClearTimeout(blankConfirmTimer);
    blankTimer = nativeTimeout(() => {
      blankTimer = 0;
      if (!sparseBlankPage()) return;
      blankConfirmTimer = nativeTimeout(() => {
        blankConfirmTimer = 0;
        if (!sparseBlankPage()) return;
        let lastReload = 0;
        try { lastReload = Number(sessionStorage.getItem(blankReloadKey) || 0); } catch (_) {}
        const now = Date.now();
        if (lastReload > 0 && now - lastReload < 120000) return;
        try { sessionStorage.setItem(blankReloadKey, String(now)); } catch (_) {}
        location.reload();
      }, 15000);
    }, 30000);
  };
)JS";
  return kFragment;
}

}  // namespace hp
