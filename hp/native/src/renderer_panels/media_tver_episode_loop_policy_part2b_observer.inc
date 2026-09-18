LR"JS(

  let observedPlayerRoot = null;
  let playerObserver = null;
  let playerObserverActive = false;
  let playerUiRevision = 0;
  const skipControlSelector = [
    '[aria-label*="スキップ"]', '[title*="スキップ"]',
    '[aria-label*="skip" i]', '[title*="skip" i]'
  ].join(',');
  const interestingPlayerSelector = [
    'video',
    skipControlSelector,
    '[aria-label*="広告"]', '[title*="広告"]',
    '[aria-label*="CM"]', '[title*="CM"]',
    '[data-testid*="ad" i]', '[class*="advert" i]',
    '[class*="commercial" i]',
    '[aria-label*="全画面"]', '[title*="全画面"]',
    '[aria-label*="fullscreen" i]', '[title*="fullscreen" i]',
    '[role="menuitem"]', '[role="radio"]', '[role="option"]',
    '[role="dialog"]', '[aria-modal="true"]'
  ].join(',');
  const skipControlObservers = new Map();
  const disconnectSkipControlObservers = () => {
    for (const observer of skipControlObservers.values()) {
      try { observer.disconnect(); } catch (_) {}
    }
    skipControlObservers.clear();
  };
  const notifyPlayerUi = (reason, delay = 40) => {
    ++playerUiRevision;
    wakeNative(reason + ':' + playerUiRevision);
    scheduleEnsure(delay);
  };
  const watchSkipControl = control => {
    if (!(control instanceof Element) || skipControlObservers.has(control)) return;
    const observer = new MutationObserver(() => {
      if (!control.isConnected ||
          !observedPlayerRoot?.contains(control)) {
        try { observer.disconnect(); } catch (_) {}
        skipControlObservers.delete(control);
        return;
      }
      notifyPlayerUi('skip-ready', 0);
    });
    observer.observe(control, {
      attributes: true,
      attributeFilter: ['disabled', 'aria-disabled', 'aria-hidden', 'class', 'style']
    });
    skipControlObservers.set(control, observer);
  };
  const bindSkipControlsIn = element => {
    if (!(element instanceof Element)) return;
    if (element.matches(skipControlSelector)) watchSkipControl(element);
    for (const control of element.querySelectorAll?.(skipControlSelector) || []) {
      watchSkipControl(control);
    }
  };
  const disconnectPlayerObserver = () => {
    try { playerObserver?.disconnect(); } catch (_) {}
    playerObserverActive = false;
    disconnectSkipControlObservers();
  };
  const bindPlayerObserver = video => {
    const root = playerRootFor(video);
    if (!root || typeof MutationObserver !== 'function') return;
    if (root !== observedPlayerRoot) {
      disconnectPlayerObserver();
      observedPlayerRoot = root;
      playerObserver = null;
    }
    if (playerObserverActive) return;
    if (!playerObserver) {
      playerObserver = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;
            const element = node;
            bindSkipControlsIn(element);
            if (element.matches?.(interestingPlayerSelector) ||
                element.querySelector?.(interestingPlayerSelector)) {
              notifyPlayerUi('ui');
              return;
            }
          }
        }
      });
    }
    playerObserver.observe(root, { childList: true, subtree: true });
    playerObserverActive = true;
    for (const control of root.querySelectorAll(skipControlSelector)) {
      watchSkipControl(control);
    }
    window.__homePanelTverEpisodeObserver = playerObserver;
  };
  const suspendPlayerObserver = () => {
    disconnectPlayerObserver();
  };
)JS"