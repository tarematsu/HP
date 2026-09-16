LR"JS(

  const strengthenCleanPresentation = () => {
    const style = document.getElementById('homepanel-tver-clean-player');
    if (!style || style.dataset.homepanelAggressive === '1') return;
    style.dataset.homepanelAggressive = '1';
    style.textContent += `
      body:has(video) > :not(:has(video)):not(script):not(style),
      body:has(video) main:has(video) > :not(:has(video)):not(video):not(script):not(style),
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
)JS"