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
  const recoverableOnboardingPattern = {{RECOVERABLE_ACTION_PATTERN}};
  const connectSurfaceLabelPattern =
    /^(?:re)?connect(?:\s+(?:to|with|your))?\s+(?:music|spotify(?:\s+account)?)$/i;
  const connectSurfaceActionPattern =
    /^(?:(?:re)?connect(?:\s+(?:to|with|your))?\s+spotify(?:\s+account)?|(?:re)?connect|spotify)$/i;
  const playbackOnlyAttribute = 'data-homepanel-stationhead-playback-only';
  const onboardingCandidateSelector =
    "button,[role='button'],a,input[type='button'],input[type='submit']," +
    "h1,h2,h3,[role='heading'],div,span,p,[tabindex],[aria-label],[data-testid]";
  const onboardingPseudoLabel = (element, pseudo) => {
    try {
      const value = getComputedStyle(element, pseudo).content;
      return value && value !== 'none' && value !== 'normal' &&
          /^["'].*["']$/.test(value) ? value.slice(1, -1) : '';
    } catch (_) { return ''; }
  };
  const onboardingLabelsOf = element => [
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('data-testid'),
    element?.getAttribute?.('title'),
    element?.getAttribute?.('alt'),
    element?.getAttribute?.('value'),
    element?.innerText,
    element?.textContent,
    onboardingPseudoLabel(element, '::before'),
    onboardingPseudoLabel(element, '::after'),
  ].map(normalize).filter(Boolean);
  const onboardingLabelMatches = (element, pattern) =>
    onboardingLabelsOf(element).some(label => pattern.test(label));
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
    onboardingRendered(element) && onboardingLabelMatches(element, pattern);

  const releasePlaybackOnlyForOnboarding = () => {
    const root = document.documentElement;
    if (!root?.hasAttribute?.(playbackOnlyAttribute)) return false;
    // Room rendering is normally hidden after a confirmed `playing` event. If
    // Stationhead later inserts a recovery prompt without first emitting pause/
    // waiting/stalled, geometry-based detection can never see that prompt. Look
    // only for the exact allowlisted labels without reading layout, then restore
    // the UI so the native locator can validate visibility and click normally.
    for (const element of document.querySelectorAll(onboardingCandidateSelector)) {
      if (onboardingLabelMatches(element, keepStreamingPattern) ||
          onboardingLabelMatches(element, recoverableOnboardingPattern) ||
          onboardingLabelMatches(element, connectSurfaceLabelPattern)) {
        root.removeAttribute(playbackOnlyAttribute);
        return true;
      }
    }
    return false;
  };

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
    // shapes: semantic buttons, styled div/span controls, and a heading/label
    // with a separate Connect/Reconnect action. Treat the visible text as the
    // stable contract and keep all matching local to the same ancestor surface.
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
    // control may be a div/span. The shared action policy keeps this broad DOM
    // search synchronized with the native trusted-click locator.
    for (const element of document.querySelectorAll(onboardingCandidateSelector)) {
      if (onboardingMatches(element, recoverableOnboardingPattern)) return true;
    }
    return splitConnectSurfaceVisible();
  };

  const publishRecoverableOnboarding = () => {
    if (!pageActive || !document.body) return false;
    releasePlaybackOnlyForOnboarding();

    // Keep Streaming is a continuation confirmation and is always eligible for
    // the trusted native allowlist while visible.
    if (publishKeepStreaming()) return true;

    // Every allowlisted music-service recovery/continuation action is treated as
    // an independent current-state action rather than a step in a fixed sequence.
    // This covers full loops, shortened flows such as Connect Spotify -> Listen
    // here instead, repeated steps, and future wording variants admitted by the
    // shared policy. There is intentionally no one-shot or sequence latch.
    if (!recoverableOnboardingVisible()) return false;

    // An exact recoverable action is visible. Keep login routes and credential
    // inputs as hard guards while ignoring unrelated Log in links in the dialog.
    if (blockingLogin(true, true)) return false;
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
