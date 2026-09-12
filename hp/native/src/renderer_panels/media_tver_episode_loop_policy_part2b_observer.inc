LR"JS(

  let observedPlayerRoot = null;
  let playerObserver = null;
  let playerUiRevision = 0;
  const interestingPlayerSelector = [
    'video',
    '[aria-label*="スキップ"]', '[title*="スキップ"]',
    '[aria-label*="skip" i]', '[title*="skip" i]',
    '[aria-label*="広告"]', '[title*="広告"]',
    '[aria-label*="CM"]', '[title*="CM"]',
    '[data-testid*="ad" i]', '[class*="advert" i]',
    '[class*="commercial" i]',
    '[aria-label*="全画面"]', '[title*="全画面"]',
    '[aria-label*="fullscreen" i]', '[title*="fullscreen" i]',
    '[role="menuitem"]', '[role="radio"]', '[role="option"]',
    '[role="dialog"]', '[aria-modal="true"]'
  ].join(',');
  const bindPlayerObserver = video => {
    const root = playerRootFor(video);
    if (!root || root === observedPlayerRoot || typeof MutationObserver !== 'function') {
      return;
    }
    try { playerObserver?.disconnect(); } catch (_) {}
    observedPlayerRoot = root;
    playerObserver = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;
          const element = node;
          if (element.matches?.(interestingPlayerSelector) ||
              element.querySelector?.(interestingPlayerSelector)) {
            ++playerUiRevision;
            wakeNative('ui:' + playerUiRevision);
            scheduleEnsure(40);
            return;
          }
        }
      }
    });
    playerObserver.observe(root, { childList: true, subtree: true });
    window.__homePanelTverEpisodeObserver = playerObserver;
  };
)JS"