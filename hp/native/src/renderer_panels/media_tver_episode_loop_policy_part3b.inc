LR"JS(

      if (!state.lowQualitySet && !state.qualityAttemptExhausted) {
        const root = playerRootFor(video);
        if (root) {
          const qualityChoices = [];
          for (const element of root.querySelectorAll(
              'button, [role="button"], [role="menuitem"], [role="radio"], '
              + '[role="option"], li')) {
            if (!visibleRect(element)) continue;
            const name = labelOf(element)
                .replace(/[（(](?:選択中|設定中)[）)]/g, '')
                .replace(/画質$/, '').trim();
            if (/^(自動|高|中|低)$/.test(name)) qualityChoices.push([element, name]);
          }
          const low = qualityChoices.find(([, name]) => name === '低');
          if (low) {
            const element = low[0];
            const selected = element.getAttribute('aria-checked') === 'true' ||
                element.getAttribute('aria-selected') === 'true' ||
                element.getAttribute('data-state') === 'checked' ||
                /選択中|設定中/.test(labelOf(element));
            if (selected) {
              state.lowQualitySet = true;
              state.lowClickPending = false;
            }
          } else if (state.lowClickPending) {
            state.lowQualitySet = true;
            state.lowClickPending = false;
          }
        }
      }

      const browserFullscreen = document.fullscreenElement ||
          document.webkitFullscreenElement || document.msFullscreenElement;
      const setupFlags = [];
      if (!state.lowQualitySet && !state.qualityAttemptExhausted) {
        setupFlags.push('quality');
      }
      if (!browserFullscreen && state.fullscreenDirty) setupFlags.push('fullscreen');
      if (setupFlags.length) {
        wakeNative('setup:' + setupFlags.join('+') + ':' + mediaIdentity(video));
      } else if (!state.adActive && !video.ended) {
        suspendPlayerObserver();
      }
    } catch (_) {}
  };

  for (const eventName of ['play', 'pause', 'loadedmetadata', 'emptied']) {
    document.addEventListener(eventName, event => {
      if (event.target instanceof HTMLMediaElement) scheduleEnsure(40);
    }, true);
  }
  const fullscreenEvents = ['fullscreenchange', 'webkitfullscreenchange'];
  const onFullscreenChange = () => {
    scheduleEnsure(40);
    const fullscreen = !!(document.fullscreenElement ||
        document.webkitFullscreenElement || document.msFullscreenElement);
    const state = window.__homePanelSakuraMeetsState;
    if (fullscreen || !state || state.fullscreenDirty) {
      wakeNative('fullscreen-change:' + (fullscreen ? '1' : '0'));
    }
  };
  for (const eventName of fullscreenEvents) {
    document.addEventListener(eventName, onFullscreenChange, true);
  }
  ensure();
  return true;
})()
)JS"