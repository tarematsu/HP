LR"JS(
(() => {
  // Episode selection is native-owned. Page policy only operates on the episode
  // URL that the native queue has already selected.
  if (location.hostname !== 'tver.jp' ||
      !location.pathname.startsWith('/episodes/')) return null;
)JS"