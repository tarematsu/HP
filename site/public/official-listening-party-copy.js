(() => {
  const YEAR_END_2025_CONTENT = '2025年にリリースした曲(29曲)';

  window.addEventListener('history:data-loaded', (event) => {
    const detail = event?.detail || {};
    if (detail.mode !== 'broadcasts' || !detail.data?.ok || !Array.isArray(detail.data.rows)) return;

    for (const row of detail.data.rows) {
      const eventName = String(row?.event_name || '');
      if (!/^2025[./-]12[./-]30/.test(eventName) || !eventName.includes('THANK YOU 2025')) continue;
      row.broadcast_content = YEAR_END_2025_CONTENT;
    }
  });
})();
