(() => {
  'use strict';

  const root = window.HomePanel;
  const { text, statusLabel, T } = root.utils;

  function showNewsAt(index) {
    const item = root.state.newsItems[index] || null;
    text('#headline-title', item?.title || T('empty.news'));
    text('#headline-detail', item?.description || '');
  }

  function renderNews(news = {}, index = 0) {
    text('#news-status', statusLabel(news));
    const incoming = Array.isArray(news.items) ? news.items : [];
    root.state.newsItems = incoming;
    root.state.newsIndex = typeof index === 'number' ? index % Math.max(1, incoming.length) : 0;
    showNewsAt(root.state.newsIndex);
  }

  root.panels = root.panels || {};
  root.panels.news = { renderNews, showNewsAt };
})();
