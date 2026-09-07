// TVer series DOM policy. Owns survey dismissal, rendered episode discovery,
// recommendation filtering, and trusted-input fallback for a rendered action.
namespace {
constexpr wchar_t kNativeMediaTverSeriesDomPolicyModuleScript[] = LR"JS(
(() => {
  window.__homePanelTverSeriesDomWatchdog = () => {
    if (location.hostname !== 'tver.jp' ||
        !location.pathname.startsWith('/series/')) return null;

    const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
    const visible = element => {
      if (!element || element.disabled ||
          element.getAttribute('aria-disabled') === 'true' ||
          element.getAttribute('aria-hidden') === 'true') return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' &&
             style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const labelOf = element => normalize(
        (element.getAttribute('aria-label') || '') + ' ' +
        (element.getAttribute('title') || '') + ' ' +
        (element.getAttribute('data-testid') || '') + ' ' +
        (element.textContent || ''));
    const point = element => {
      if (!visible(element) || window.innerWidth <= 0 || window.innerHeight <= 0) {
        return null;
      }
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      if (centerX < 0 || centerX > window.innerWidth ||
          centerY < 0 || centerY > window.innerHeight) return null;
      return [
        Math.max(0, Math.min(10000, Math.round((centerX / window.innerWidth) * 10000))),
        Math.max(0, Math.min(10000, Math.round((centerY / window.innerHeight) * 10000)))
      ];
    };

    const controls = Array.from(document.querySelectorAll(
        'button, [role="button"], a, [aria-label], [title]'));
    const surveyClose = controls.find(element => {
      if (!visible(element)) return false;
      const label = labelOf(element);
      if (!/(?:閉じる|とじる|close|dismiss)/i.test(label)) return false;
      let scope = element;
      for (let depth = 0; scope && depth < 10;
           ++depth, scope = scope.parentElement) {
        if (/(?:アンケート|ご回答|回答する|誕生年|誕生月|性別)/.test(
            normalize(scope.textContent))) return true;
      }
      const dialog = element.closest('[role="dialog"], [aria-modal="true"]');
      return !!dialog &&
          /(?:アンケート|ご回答|回答する|誕生年|誕生月|性別)/.test(
              normalize(dialog.textContent));
    });
    if (surveyClose) return point(surveyClose);

    const normalizeEpisodeHref = href => {
      try {
        const url = new URL(href, location.href);
        if (url.origin !== location.origin ||
            !url.pathname.startsWith('/episodes/')) return '';
        url.hash = '';
        return url.href;
      } catch (_) {
        return '';
      }
    };
    const foreignHeading =
        /(?:あなたにおすすめ|おすすめ|関連番組|関連動画|ランキング)/;
    const episodeHeading =
        /(?:エピソード|配信中|最新話|最新エピソード|見逃し配信)/;
    const headingSelector = 'h1, h2, h3, h4, h5, h6, [role="heading"]';

    const isInsideForeignSection = element => {
      let scope = element ? element.closest('article, li, section') : null;
      for (let depth = 0; scope && depth < 6;
           ++depth, scope = scope.parentElement &&
               scope.parentElement.closest('article, li, section')) {
        const heading = scope.querySelector(headingSelector);
        if (heading && foreignHeading.test(normalize(heading.textContent))) {
          return true;
        }
      }
      return false;
    };

    const seriesEpisodeLinks = () => {
      const headings = Array.from(document.querySelectorAll(headingSelector));
      const anchorHeading = headings.find(element => {
        const text = normalize(element.textContent);
        return episodeHeading.test(text) && !foreignHeading.test(text);
      }) || null;
      if (anchorHeading) {
        let container = anchorHeading.parentElement;
        while (container && container !== document.body) {
          const links = Array.from(
              container.querySelectorAll('a[href*="/episodes/"]'))
              .filter(link => link.href);
          if (links.length) {
            const hasForeignSection = Array.from(
                container.querySelectorAll(headingSelector)).some(element =>
              element !== anchorHeading &&
              foreignHeading.test(normalize(element.textContent)));
            if (!hasForeignSection) return links;
          }
          container = container.parentElement;
        }
      }
      const root = document.querySelector('main') || document.body;
      if (!root) return [];
      return Array.from(root.querySelectorAll('a[href*="/episodes/"]')).filter(link =>
        !!link.href && !isInsideForeignSection(link));
    };

    const rawLinks = seriesEpisodeLinks();
    const seen = new Set();
    const links = rawLinks.filter(link => {
      const href = normalizeEpisodeHref(link.href);
      if (!href || seen.has(href)) return false;
      seen.add(href);
      link.__homePanelNormalizedEpisodeHref = href;
      return true;
    });

    if (links.length) {
      const latest = links.find(link => {
        const card = link.closest('article, li, section, div') || link;
        return /(?:最新話|最新エピソード|最新|NEW)/i.test(labelOf(card));
      }) || links[0];
      const hrefs = links.map(link => link.__homePanelNormalizedEpisodeHref);
      const latestIndex = Math.max(0, links.indexOf(latest));
      const latestHref = latest.__homePanelNormalizedEpisodeHref ||
          hrefs[latestIndex] || '';
      try {
        sessionStorage.setItem('__homePanelTverSeriesPath', location.pathname);
        sessionStorage.setItem(
            '__homePanelTverEpisodeQueue:' + location.pathname,
            JSON.stringify({ hrefs, index: latestIndex }));
      } catch (_) {
      }
      if (latestHref) location.replace(latestHref);
      return null;
    }

    const root = document.querySelector('main') || document.body;
    if (!root) return null;
    const action = Array.from(root.querySelectorAll(
        'button, [role="button"], a, [aria-label], [title]')).find(element => {
      if (isInsideForeignSection(element)) return false;
      return /(?:エピソードを再生|最新話を再生|最新エピソードを再生|本編を再生)/
          .test(labelOf(element));
    }) || null;
    if (!action) return null;
    try {
      sessionStorage.setItem('__homePanelTverSeriesPath', location.pathname);
      sessionStorage.removeItem(
          '__homePanelTverEpisodeQueue:' + location.pathname);
    } catch (_) {
    }
    const actionPoint = point(action);
    if (actionPoint) return actionPoint;
    try { action.click(); } catch (_) {}
    return null;
  };
})()
)JS";
}  // namespace
