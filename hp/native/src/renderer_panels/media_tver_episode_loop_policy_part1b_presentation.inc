LR"JS(

  const strengthenCleanPresentation = () => {
    const style = document.getElementById('homepanel-tver-clean-player');
    if (!style || style.dataset.homepanelAggressive === '1') return;
    style.dataset.homepanelAggressive = '1';
    style.textContent += `
      body:has(video) > :not(:has(video)):not(script):not(style):not([role="dialog"]):not([aria-modal="true"]):not(:has([role="dialog"])):not(:has([aria-modal="true"])),
      body:has(video) main:has(video) > :not(:has(video)):not(video):not(script):not(style):not([role="dialog"]):not([aria-modal="true"]):not(:has([role="dialog"])):not(:has([aria-modal="true"])),
      body:has(video) [data-testid*="breadcrumb" i]:not(:has(video)),
      body:has(video) [class*="breadcrumb" i]:not(:has(video)),
      body:has(video) [data-testid*="recommend" i]:not(:has(video)),
      body:has(video) [class*="recommend" i]:not(:has(video)),
      body:has(video) [data-testid*="related" i]:not(:has(video)),
      body:has(video) [class*="related" i]:not(:has(video)),
      body:has(video) [data-testid*="share" i]:not(:has(video)),
      body:has(video) [class*="share" i]:not(:has(video)),
      body:has(video) [data-testid*="social" i]:not(:has(video)),
      body:has(video) [class*="social" i]:not(:has(video)),
      body:has(video) [data-testid*="synopsis" i]:not(:has(video)),
      body:has(video) [class*="synopsis" i]:not(:has(video)),
      body:has(video) [data-testid*="description" i]:not(:has(video)),
      body:has(video) [class*="description" i]:not(:has(video)),
      body:has(video) [data-testid*="detail" i]:not(:has(video)),
      body:has(video) [class*="detail" i]:not(:has(video)),
      body:has(video) [data-testid*="metadata" i]:not(:has(video)),
      body:has(video) [class*="metadata" i]:not(:has(video)),
      body:has(video) [data-testid*="cast" i]:not(:has(video)),
      body:has(video) [class*="cast" i]:not(:has(video)),
      body:has(video) [data-testid*="genre" i]:not(:has(video)),
      body:has(video) [class*="genre" i]:not(:has(video)),
      body:has(video) [data-testid*="tag" i]:not(:has(video)),
      body:has(video) [class*="tag" i]:not(:has(video)),
      body:has(video) [data-testid*="program-info" i]:not(:has(video)),
      body:has(video) [class*="program-info" i]:not(:has(video)),
      body:has(video) [data-testid*="episode-info" i]:not(:has(video)),
      body:has(video) [class*="episode-info" i]:not(:has(video)) {
        display:none !important;
      }

      html:has(body video),
      body:has(video),
      body:has(video) main:has(video) {
        background:#000 !important;
      }

      html[data-homepanel-tver-viewport-fullscreen="1"],
      html[data-homepanel-tver-viewport-fullscreen="1"] body {
        width:100% !important;
        height:100% !important;
        margin:0 !important;
        overflow:hidden !important;
        background:#000 !important;
      }

      [data-homepanel-tver-viewport-ancestor="1"] {
        transform:none !important;
        perspective:none !important;
        filter:none !important;
        contain:none !important;
        clip-path:none !important;
        overflow:visible !important;
      }

      [data-homepanel-tver-viewport-root="1"] {
        position:fixed !important;
        inset:0 !important;
        width:100vw !important;
        height:100vh !important;
        min-width:100vw !important;
        min-height:100vh !important;
        max-width:none !important;
        max-height:none !important;
        margin:0 !important;
        padding:0 !important;
        transform:none !important;
        z-index:2147483000 !important;
        overflow:hidden !important;
        background:#000 !important;
      }

      [data-homepanel-tver-viewport-root="1"] video,
      video[data-homepanel-tver-viewport-root="1"] {
        width:100% !important;
        height:100% !important;
        min-width:100% !important;
        min-height:100% !important;
        max-width:none !important;
        max-height:none !important;
        margin:0 !important;
        object-fit:contain !important;
        background:#000 !important;
      }

      body:has(video) {
        margin:0 !important;
        overflow:hidden !important;
      }

      body:has(video) main:has(video) {
        max-height:100vh !important;
        overflow:hidden !important;
      }
    `;
  };
  strengthenCleanPresentation();

  const clearViewportFullscreenMarks = () => {
    for (const element of document.querySelectorAll(
        '[data-homepanel-tver-viewport-root], [data-homepanel-tver-viewport-ancestor]')) {
      element.removeAttribute('data-homepanel-tver-viewport-root');
      element.removeAttribute('data-homepanel-tver-viewport-ancestor');
    }
    document.documentElement.removeAttribute(
        'data-homepanel-tver-viewport-fullscreen');
  };
  const coversViewport = element => {
    if (!(element instanceof HTMLElement) ||
        window.innerWidth <= 0 || window.innerHeight <= 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width >= window.innerWidth * 0.95 &&
        rect.height >= window.innerHeight * 0.95 &&
        rect.left <= window.innerWidth * 0.03 &&
        rect.top <= window.innerHeight * 0.03 &&
        rect.right >= window.innerWidth * 0.97 &&
        rect.bottom >= window.innerHeight * 0.97;
  };
  window.__homePanelTverEnsureViewportFullscreen = media => {
    if (!(media instanceof HTMLMediaElement)) return false;
    clearViewportFullscreenMarks();

    const candidates = [];
    const player = media.closest(
        '[data-testid*="player" i], [class*="player" i], [id*="player" i]');
    if (player instanceof HTMLElement) candidates.push(player);
    if (media.parentElement instanceof HTMLElement &&
        !candidates.includes(media.parentElement)) {
      candidates.push(media.parentElement);
    }
    if (!candidates.includes(media)) candidates.push(media);

    for (const target of candidates) {
      const ancestors = [];
      for (let ancestor = target.parentElement;
           ancestor && ancestor !== document.body;
           ancestor = ancestor.parentElement) {
        ancestors.push(ancestor);
        ancestor.setAttribute('data-homepanel-tver-viewport-ancestor', '1');
      }
      target.setAttribute('data-homepanel-tver-viewport-root', '1');
      document.documentElement.setAttribute(
          'data-homepanel-tver-viewport-fullscreen', '1');
      if (coversViewport(target)) return true;

      target.removeAttribute('data-homepanel-tver-viewport-root');
      for (const ancestor of ancestors) {
        ancestor.removeAttribute('data-homepanel-tver-viewport-ancestor');
      }
    }
    clearViewportFullscreenMarks();
    return false;
  };
  const initialViewportVideo = currentVideo();
  if (initialViewportVideo) {
    try { window.__homePanelTverEnsureViewportFullscreen(initialViewportVideo); }
    catch (_) {}
  }
)JS"