// Document-start YouTube presentation and lightweight ad-skip wake policy.
namespace {
constexpr wchar_t kNativeMediaYoutubeCleanPlayerScript[] = LR"JS(
(() => {
  if (!/^(www\.)?youtube\.com$/.test(location.hostname)) return false;

  const skipSelector = [
    '.ytp-ad-skip-button', '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button', '.videoAdUiSkipButton',
    '[class*="ytp-ad-skip"]', '[aria-label*="Skip ad" i]',
    '[aria-label*="広告をスキップ"]', '[aria-label*="広告を飛ばす"]'
  ].join(',');
  const adActive = player => Boolean(
      player?.classList.contains('ad-showing') ||
      player?.classList.contains('ad-interrupting'));
  const postSkipWake = () => {
    const now = Date.now();
    if (now - Number(window.__homePanelYoutubeSkipWakeAt || 0) < 80) return;
    window.__homePanelYoutubeSkipWakeAt = now;
    try { window.chrome?.webview?.postMessage('homepanel:youtube-wake'); }
    catch (_) {}
  };
  const bindSkipObserver = player => {
    if (!player || typeof MutationObserver !== 'function') return;
    const previous = window.__homePanelYoutubeSkipObserver;
    if (previous?.player === player) return;
    try { previous?.rootObserver?.disconnect(); } catch (_) {}
    try { previous?.classObserver?.disconnect(); } catch (_) {}
    try { previous?.clearControlObservers?.(); } catch (_) {}

    const controlObservers = new Map();
    const clearControlObservers = () => {
      for (const observer of controlObservers.values()) {
        try { observer.disconnect(); } catch (_) {}
      }
      controlObservers.clear();
    };
    const watchControl = (control, wakeNow = false) => {
      if (!(control instanceof Element) || controlObservers.has(control)) return;
      const observer = new MutationObserver(() => {
        if (!control.isConnected || !player.contains(control)) {
          try { observer.disconnect(); } catch (_) {}
          controlObservers.delete(control);
          return;
        }
        if (adActive(player)) postSkipWake();
      });
      observer.observe(control, {
        attributes: true,
        attributeFilter: ['disabled', 'aria-disabled', 'aria-hidden', 'class', 'style']
      });
      controlObservers.set(control, observer);
      if (wakeNow && adActive(player)) postSkipWake();
    };
    const inspectAddedNode = node => {
      if (!(node instanceof Element)) return;
      if (node.matches(skipSelector)) watchControl(node, true);
      for (const control of node.querySelectorAll?.(skipSelector) || []) {
        watchControl(control, true);
      }
    };
    const primeControls = () => {
      if (!adActive(player)) {
        clearControlObservers();
        return;
      }
      for (const control of player.querySelectorAll(skipSelector)) {
        watchControl(control);
      }
      if (player.querySelector(skipSelector)) postSkipWake();
    };

    const rootObserver = new MutationObserver(mutations => {
      if (!adActive(player)) return;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) inspectAddedNode(node);
      }
    });
    rootObserver.observe(player, { childList: true, subtree: true });

    const classObserver = new MutationObserver(primeControls);
    classObserver.observe(player, {
      attributes: true,
      attributeFilter: ['class']
    });

    window.__homePanelYoutubeSkipObserver = {
      player, rootObserver, classObserver, clearControlObservers
    };
    primeControls();
  };
  const installSkipObserver = () => {
    const player = document.querySelector('#movie_player');
    if (!player) return false;
    bindSkipObserver(player);
    return true;
  };

  const mount = () => {
    const root = document.head || document.documentElement;
    if (!root || document.getElementById('homepanel-youtube-clean-player')) return;
    const style = document.createElement('style');
    style.id = 'homepanel-youtube-clean-player';
    style.textContent = `
      ytd-watch-flexy #secondary,
      ytd-watch-flexy #below,
      ytd-watch-flexy #chat-container,
      ytd-watch-flexy #panels,
      ytd-watch-flexy #related,
      ytd-watch-flexy ytd-comments,
      ytd-masthead,
      ytd-mini-guide-renderer,
      ytd-guide-renderer {
        display:none !important;
      }

      #movie_player:not(.ad-showing):not(.ad-interrupting) > :not(.html5-video-container),
      #movie_player .html5-video-container > :not(video),
      #movie_player :is(.ytp-chrome-top,.ytp-chrome-bottom,.ytp-gradient-top,.ytp-gradient-bottom) {
        opacity:0 !important;
        transition:none !important;
        animation:none !important;
      }

      #movie_player .ytp-ad-skip-button,
      #movie_player .ytp-ad-skip-button-modern,
      #movie_player .ytp-skip-ad-button,
      #movie_player .videoAdUiSkipButton,
      #movie_player [class*="ytp-ad-skip"],
      #movie_player [aria-label*="Skip ad" i],
      #movie_player [aria-label*="広告をスキップ"],
      #movie_player [aria-label*="広告を飛ばす"] {
        opacity:1 !important;
        visibility:visible !important;
        pointer-events:auto !important;
      }

      #movie_player .ytp-share-button,
      #movie_player [aria-label="共有"],
      #movie_player [aria-label^="Share" i],
      ytd-unified-share-panel-renderer,
      tp-yt-paper-dialog:has(ytd-unified-share-panel-renderer) {
        display:none !important;
      }
    `;
    root.appendChild(style);
  };
  const install = () => {
    mount();
    if (installSkipObserver()) {
      try { window.__homePanelYoutubeSkipBootstrapObserver?.disconnect(); } catch (_) {}
      window.__homePanelYoutubeSkipBootstrapObserver = null;
      return;
    }
    const root = document.documentElement;
    if (!root || window.__homePanelYoutubeSkipBootstrapObserver ||
        typeof MutationObserver !== 'function') return;
    const bootstrap = new MutationObserver(() => {
      if (!installSkipObserver()) return;
      bootstrap.disconnect();
      if (window.__homePanelYoutubeSkipBootstrapObserver === bootstrap) {
        window.__homePanelYoutubeSkipBootstrapObserver = null;
      }
    });
    bootstrap.observe(root, { childList: true, subtree: true });
    window.__homePanelYoutubeSkipBootstrapObserver = bootstrap;
  };

  install();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  }
  return true;
})()
)JS";
}  // namespace
