#pragma once

namespace hp {

// Stationhead music-service onboarding/recovery plus explicit playback
// continuation prompts. This is appended inside the same compact-runtime IIFE
// after the base interaction helpers are declared. It deliberately reuses
// visible/account/blocking helpers from that owner and only publishes signals
// for the explicit native trusted-click allowlist.
inline std::wstring_view StationheadRuntimeOnboardingFragment() noexcept {
  static constexpr std::wstring_view kFragment = LR"JS(
  const keepStreamingPattern = /^keep\s+streaming$/i;
  const recoverableOnboardingPattern =
    /^(?:(?:re)?connect(?:\s+(?:to|with|your))?\s+(?:spotify(?:\s+account)?|music)|continue(?:\s+with\s+spotify)?|let(?:'|’)?s\s+go)$/i;
  const connectSurfaceLabelPattern =
    /^(?:re)?connect(?:\s+(?:to|with|your))?\s+(?:music|spotify(?:\s+account)?)$/i;
  const connectSurfaceActionPattern =
    /^(?:(?:re)?connect(?:\s+(?:to|with|your))?\s+spotify(?:\s+account)?|(?:re)?connect|spotify)$/i;
  const onboardingCandidateSelector =
    "button,[role='button'],a,input[type='button'],input[type='submit']," +
    "div,span,p,[tabindex],[aria-label],[data-testid]";
  const onboardingLabelsOf = element => [
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('data-testid'),
    element?.getAttribute?.('title'),
    element?.getAttribute?.('alt'),
    element?.getAttribute?.('value'),
    element?.innerText,
    element?.textContent,
  ].map(normalize).filter(Boolean);
  const onboardingRendered = element => {
    if (!(element instanceof Element) || !element.isConnected ||
        element.getAttribute('aria-hidden') === 'true') return false;
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 2 || rect.height <= 2) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      Number(style.opacity || 1) > 0;
  };
  const onboardingMatches = (element, pattern) =>
    onboardingRendered(element) &&
    onboardingLabelsOf(element).some(label => pattern.test(label));

  const keepStreamingVisible = () => {
    for (const element of document.querySelectorAll(onboardingCandidateSelector)) {
      if (onboardingMatches(element, keepStreamingPattern)) return true;
    }
    return false;
  };

  const publishKeepStreaming = () => {
    if (!pageActive || !document.body || !keepStreamingVisible()) return false;
    postText('start-visible');
    return true;
  };

  const splitConnectSurfaceVisible = () => {
    // Stationhead has rendered music-service prompts in several different DOM
    // shapes: semantic buttons, styled div/span controls, and a label with a
    // separate Connect/Reconnect action. Treat the visible text as the stable
    // contract and keep all matching local to the same ancestor surface.
    for (const anchor of document.querySelectorAll(onboardingCandidateSelector)) {
      if (!onboardingMatches(anchor, connectSurfaceLabelPattern)) continue;
      for (let surface = anchor.parentElement, depth = 0;
           surface && surface !== document.body && depth < 10;
           surface = surface.parentElement, depth += 1) {
        if (!onboardingRendered(surface)) continue;
        for (const action of surface.querySelectorAll(onboardingCandidateSelector)) {
          if (onboardingMatches(action, connectSurfaceActionPattern)) return true;
        }
      }
    }
    return false;
  };

  const recoverableOnboardingVisible = () => {
    // Do not depend on element semantics. A visually button-like Stationhead
    // control may be a div/span. Exact allowlisted labels keep this broad DOM
    // search from turning account/login controls into automatic clicks.
    for (const element of document.querySelectorAll(onboardingCandidateSelector)) {
      if (onboardingMatches(element, recoverableOnboardingPattern)) return true;
    }
    return splitConnectSurfaceVisible();
  };

  const publishRecoverableOnboarding = () => {
    // Keep Streaming is a continuation confirmation and is always eligible for
    // the trusted native allowlist while visible.
    if (publishKeepStreaming()) return true;

    // Connect/Reconnect/Continue/Let's GO are explicit Stationhead onboarding
    // actions, not playback-state transitions. Signal them whenever they are
    // visible, including before first playback and while stale audio state still
    // reports playing. The native locator revalidates the same narrow allowlist
    // at click-time. Genuine login routes/forms still block automation.
    if (!pageActive || !document.body || !recoverableOnboardingVisible()) {
      return false;
    }
    // Once an explicit recoverable onboarding control is visible, do not let an
    // unrelated standalone `Log in` header button suppress the click. Passing
    // `true` keeps blockingLogin's hard guards for login routes, credential
    // inputs, and login controls inside a visible modal/shell.
    if (blockingLogin(true)) return false;
    cancelAuthReady();
    lastBlocking = false;
    window.__homepanelStationheadBlockingLoginVisible = false;
    post({ type: 'stationhead-auth-ready', source: 'recoverable-onboarding' });
    postText('start-visible');
    return true;
  };
)JS";
  return kFragment;
}

}  // namespace hp
