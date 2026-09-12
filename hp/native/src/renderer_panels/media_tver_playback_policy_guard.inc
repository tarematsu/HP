LR"JS(
(() => {
  if (location.hostname !== 'tver.jp' ||
      !location.pathname.startsWith('/episodes/')) return null;

  const episodeQueueKey = '__homePanelTverEpisodeQueue';
  const guardedEpisodePathKey = '__homePanelTverGuardedEpisodePath';
  const guardRestartKey = '__homePanelTverGuardRestart';
  const launcherParam = 'homepanel_launch';
  const directLaunch = new URLSearchParams(location.search).get(launcherParam) === '1';
  const normalizeEpisodeHref = href => {
    try {
      const url = new URL(href, location.href);
      if (url.protocol !== 'https:' || url.hostname !== 'tver.jp' ||
          !/^\/episodes\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return '';
      url.pathname = url.pathname.replace(/\/$/, '');
      url.search = '';
      url.hash = '';
      return url.toString();
    } catch (_) {
      return '';
    }
  };
  const requestRestart = () => {
    window[guardRestartKey] = true;
    return false;
  };
  const clearLauncherMarker = () => {
    if (!directLaunch) return;
    try {
      const url = new URL(location.href);
      url.searchParams.delete(launcherParam);
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch (_) {}
  };
  const guardCloudEpisode = () => {
    if (window[guardedEpisodePathKey] === location.pathname) return true;

    let queue = null;
    try { queue = JSON.parse(sessionStorage.getItem(episodeQueueKey) || 'null'); }
    catch (_) {}
    const hrefs = queue && Array.isArray(queue.hrefs)
        ? queue.hrefs.map(normalizeEpisodeHref).filter(Boolean)
        : [];
    if (hrefs.some(href => {
      try { return new URL(href).pathname === location.pathname; }
      catch (_) { return false; }
    })) {
      clearLauncherMarker();
      window[guardRestartKey] = false;
      window[guardedEpisodePathKey] = location.pathname;
      return true;
    }

    if (!directLaunch) return requestRestart();
    const currentHref = normalizeEpisodeHref(location.href);
    if (!currentHref) return requestRestart();
    try {
      sessionStorage.setItem(
          episodeQueueKey, JSON.stringify({ hrefs: [currentHref], index: 0 }));
    } catch (_) {
      return requestRestart();
    }
    clearLauncherMarker();
    window[guardRestartKey] = false;
    window[guardedEpisodePathKey] = location.pathname;
    return true;
  };
  if (!guardCloudEpisode()) {
    return window[guardRestartKey] ? 'restart' : null;
  }
)JS"