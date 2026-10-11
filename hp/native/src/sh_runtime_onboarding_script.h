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
  // Most room nodes are not actionable. Test cheap DOM strings before
  // reading innerText (layout) or pseudo-element styles (computed style).
  // Keep both fallbacks for CSS-label-only Connect Spotify controls.
  // Most recovery probes run while the room is in playback-only mode.
  // Match all three eligible recovery labels against one read of each DOM
  // field and CSS pseudo-label, instead of repeating innerText/style reads
  // three times for every unrelated room node. Single-pattern callers still
  // retain the exact same matching behavior.
  const onboardingLabelMatches = (
      element, pattern, additionalPattern = null, alternatePattern = null) => {
    const matches = value => {
      if (!value) return false;
      const normalized = normalize(value);
      return pattern.test(normalized) ||
        (additionalPattern !== null && additionalPattern.test(normalized)) ||
        (alternatePattern !== null && alternatePattern.test(normalized));
    };
    for (const value of [
      element?.getAttribute?.('aria-label'),
      element?.getAttribute?.('data-testid'),
      element?.getAttribute?.('title'),
      element?.getAttribute?.('alt'),
      element?.getAttribute?.('value'),
      element?.textContent,
    ]) {
      if (matches(value)) return true;
    }
    if (matches(element?.innerText)) return true;
    for (const pseudo of ['::before', '::after']) {
      if (matches(onboardingPseudoLabel(element, pseudo))) return true;
    }
    return false;
  };
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
    onboardingLabelMatches(element, pattern) && onboardingRendered(element);

  const releasePlaybackOnlyForOnboarding = candidates => {
    const root = document.documentElement;
    if (!root?.hasAttribute?.(playbackOnlyAttribute)) return false;
    // Room rendering is normally hidden after a confirmed `playing` event. If
    // Stationhead later inserts a recovery prompt without first emitting pause/
    // waiting/stalled, geometry-based detection can never see that prompt. Look
    // only for the exact allowlisted labels without reading layout, then restore
    // the UI so the native locator can validate visibility and click normally.
    for (const element of candidates) {
      if (onboardingLabelMatches(
          element, keepStreamingPattern, recoverableOnboardingPattern,
          connectSurfaceLabelPattern)) {
        root.removeAttribute(playbackOnlyAttribute);
        return true;
      }
    }
    return false;
  };

  const keepStreamingVisible = candidates => {
    for (const element of candidates) {
      if (onboardingMatches(element, keepStreamingPattern)) return true;
    }
    return false;
  };

  const publishKeepStreaming = candidates => {
    if (!pageActive || !document.body || !keepStreamingVisible(candidates)) return false;
    postText('start-visible');
    return true;
  };

  const splitConnectSurfaceVisible = candidates => {
    // Stationhead has rendered music-service prompts in several different DOM
    // shapes: semantic buttons, styled div/span controls, and a heading/label
    // with a separate Connect/Reconnect action. Treat the visible text as the
    // stable contract and keep all matching local to the same ancestor surface.
    for (const anchor of candidates) {
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

  const recoverableOnboardingVisible = candidates => {
    // Do not depend on element semantics. A visually button-like Stationhead
    // control may be a div/span. The shared action policy keeps this broad DOM
    // search synchronized with the native trusted-click locator.
    for (const element of candidates) {
      if (onboardingMatches(element, recoverableOnboardingPattern)) return true;
    }
    return splitConnectSurfaceVisible(candidates);
  };

  const publishRecoverableOnboarding = () => {
    if (!pageActive || !document.body) return false;
    // One DOM snapshot per probe, reused for hidden recovery detection,
    // Keep Streaming priority, and the generic action fallback. Avoid 3-4
    // separate full-room selector traversals on every healthy WebView tick.
    const candidates = document.querySelectorAll(onboardingCandidateSelector);
    releasePlaybackOnlyForOnboarding(candidates);

    // Keep Streaming is a continuation confirmation and is always eligible for
    // the trusted native allowlist while visible.
    if (publishKeepStreaming(candidates)) return true;

    // Every allowlisted music-service recovery/continuation action is treated as
    // an independent current-state action rather than a step in a fixed sequence.
    // This covers full loops, shortened flows such as Connect Spotify -> Listen
    // here instead, repeated steps, and future wording variants admitted by the
    // shared policy. There is intentionally no one-shot or sequence latch.
    if (!recoverableOnboardingVisible(candidates)) return false;

    // An exact recoverable action is visible. Keep login routes and credential
    // inputs as hard guards while ignoring unrelated Log in links in the dialog.
    if (blockingLogin(true, true)) return false;
    // The prompt is evidence that an action is available, not that the account
    // is authenticated. Preserve the native login latch until the real auth
    // completion signal; resetting it here also retriggers stats requests.
    cancelAuthReady();
    postText('start-visible');
    return true;
  };
)JS";
  return kFragment;
}

}  // namespace hp
