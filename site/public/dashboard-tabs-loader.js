queueMicrotask(() => {
  import('/dashboard-tabs.js?v=20261002.1').catch((error) => {
    console.error('dashboard navigation failed to start', error);
  });
});
