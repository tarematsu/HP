LR"JS(

      // Quality discovery is bounded and rate-limited. Once low quality is set,
      // state.lowQualitySet prevents any further setting attempts for this video.
      const now = Date.now();
      if (!state.lowQualitySet && state.qualityProbeAttempts < qualityProbeLimit &&
          now - state.qualityProbeAt >= qualityProbeIntervalMs) {
        state.qualityProbeAt = now;
        ++state.qualityProbeAttempts;
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
          const labels = new Set(qualityChoices.map(([, name]) => name));
          const low = qualityChoices.find(([, name]) => name === '低');
          if (labels.size >= 3 && low) {
            const element = low[0];
            const selected = element.getAttribute('aria-checked') === 'true' ||
                element.getAttribute('aria-selected') === 'true' ||
                element.getAttribute('data-state') === 'checked' ||
                /選択中|設定中/.test(labelOf(element));
            if (!selected) {
              try { element.click(); } catch (_) {}
            }
            state.lowQualitySet = true;
          }
        }
        if (!state.lowQualitySet && state.qualityProbeAttempts < qualityProbeLimit) {
          window.setTimeout(scheduleEnsure, qualityProbeIntervalMs + 20);
        }
      }

      const browserFullscreen = document.fullscreenElement ||
          document.webkitFullscreenElement || document.msFullscreenElement;
      const recoveryFlags = [];
      if (video.paused && !video.ended) recoveryFlags.push('paused');
      if (!browserFullscreen && state.fullscreenDirty) recoveryFlags.push('fullscreen');
      if (recoveryFlags.length) {
        wakeNative('recovery:' + recoveryFlags.join('+') + ':' + mediaIdentity(video));
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