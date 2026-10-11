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

  // A normal probe must consider Keep Streaming before any other recovery
  // prompt, even when a reconnect button occurs earlier in document order.
  // Decode both labels in one pass over each element's text and pseudo labels;
  // only matched candidates need a layout/visibility check.
  const onboardingActionKind = element => {
    let recoverable = false;
    const consider = value => {
      if (!value) return false;
      const label = normalize(value);
      if (keepStreamingPattern.test(label)) return true;
      if (recoverableOnboardingPattern.test(label)) recoverable = true;
      return false;
    };
    for (const value of [
      element?.getAttribute?.('aria-label'),
      element?.getAttribute?.('data-testid'),
      element?.getAttribute?.('title'),
      element?.getAttribute?.('alt'),
      element?.getAttribute?.('value'),
      element?.textContent,
    ]) {
      if (consider(value)) return onboardingRendered(element) ? 1 : 0;
    }
    if (consider(element?.innerText)) return onboardingRendered(element) ? 1 : 0;
    for (const pseudo of ['::before', '::after']) {
      if (consider(onboardingPseudoLabel(element, pseudo))) {
        return onboardingRendered(element) ? 1 : 0;
      }
    }
    return recoverable && onboardingRendered(element) ? 2 : 0;
  };

  const scanOnboardingCandidates = candidates => {
    let recoverable = false;
    for (const element of candidates) {
      const kind = onboardingActionKind(element);
      if (kind === 1) return 1;
      if (kind === 2) recoverable = true;
    }
    return recoverable ? 2 : 0;
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

  const publishRecoverableOnboarding = () => {
    if (!pageActive || !document.body) return false;
    // One DOM snapshot per probe, reused for hidden recovery detection,
    // Keep Streaming priority, and the generic action fallback. Avoid 3-4
    // separate full-room selector traversals on every healthy WebView tick.
    const candidates = document.querySelectorAll(onboardingCandidateSelector);
    releasePlaybackOnlyForOnboarding(candidates);

    // One scan covers continuation and recovery candidates. Keep Streaming
    // retains priority even if it follows an earlier Connect Spotify button.
    // Other allowlisted actions remain sequence-independent; a split
    // Connect/Reconnect surface is checked only if no single-node match exists.
    // There is intentionally no one-shot or sequence latch.
    const actionKind = scanOnboardingCandidates(candidates);
    if (actionKind === 1) {
      postText('start-visible');
      return true;
    }
    if (actionKind !== 2 && !splitConnectSurfaceVisible(candidates)) return false;

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
