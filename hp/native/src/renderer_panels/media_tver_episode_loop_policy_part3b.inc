LR"JS(

      // Quality discovery is event driven and player-local. Native owns the
      // trusted clicks; this page policy only detects completion and requests
      // another step when low quality has not settled yet.
      if (!state.lowQualitySet) {
        if (!state.qualityAttemptExhausted) {
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
              // The Low option disappearing immediately after the trusted click is
              // TVer's normal menu-close transition and is treated as completion.
              state.lowQualitySet = true;
              state.lowClickPending = false;
            }
          }
        }
      }

      const browserFullscreen = document.fullscreenElement ||
          document.webkitFullscreenElement || document.msFullscreenElement;
      const recoveryFlags = [];
      if (!state.lowQualitySet && !state.qualityAttemptExhausted) {
        recoveryFlags.push('quality');
      }
      if (video.paused && !video.ended) recoveryFlags.push('paused');
      if (!browserFullscreen && state.fullscreenDirty) recoveryFlags.push('fullscreen');
      if (recoveryFlags.length) {
        wakeNative('recovery:' + recoveryFlags.join('+') + ':' + mediaIdentity(video));
      } else if (!state.adActive && !video.ended) {
        // Once playback is fully configured and healthy, media events and the
        // low-frequency native watchdog are sufficient. Drop the player subtree
        // observer until a media/recovery event schedules ensure() again.
        suspendPlayerObserver();
      }
    } catch (_) {}
  };

  // Capture media events so a newly replaced <video> can be discovered without
  // observing the whole document. Only media events schedule a state pass.
  for (const eventName of ['play', 'pause', 'loadedmetadata', 'emptied']) {
    document.addEventListener(eventName, event => {
      if (event.target instanceof HTMLMediaElement) scheduleEnsure(40);
    }, true);
  }
  document.addEventListener('fullscreenchange', () => {
    scheduleEnsure(40);
    const fullscreen = !!(document.fullscreenElement ||
        document.webkitFullscreenElement || document.msFullscreenElement);
    const state = window.__homePanelSakuraMeetsState;
    if (fullscreen || !state || state.fullscreenDirty) {
      wakeNative('fullscreen-change:' + (fullscreen ? '1' : '0'));
    }
  }, true);
  document.addEventListener('webkitfullscreenchange', () => {
    scheduleEnsure(40);
    const fullscreen = !!(document.fullscreenElement ||
        document.webkitFullscreenElement || document.msFullscreenElement);
    const state = window.__homePanelSakuraMeetsState;
    if (fullscreen || !state || state.fullscreenDirty) {
      wakeNative('fullscreen-change:' + (fullscreen ? '1' : '0'));
    }
  }, true);
  ensure();
  return true;
})()
)JS"