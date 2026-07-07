(() => {
  'use strict';

  const root = window.HomePanel;
  const { text, format, T, fallbackWeekdays } = root.utils;

  function updateClock() {
    const now = new Date();
    const weekdayNames = T('weekdayNames') || fallbackWeekdays;
    text('#date', format(T('dateSuffix'), {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      weekday: weekdayNames[now.getDay()] || '',
    }));
    text('#clock', now.toLocaleTimeString('ja-JP', { hour12: false }));
  }

  root.panels = root.panels || {};
  root.panels.clock = { updateClock };
})();
