(() => {
  'use strict';

  const root = window.HomePanel;
  const { $, text, finite, number, statusLabel, fallbackWeekdaysShort, T } = root.utils;
  const kwhUnitYen = 32;
  let energyHistory = [];

  function energyCanvas() {
    const canvas = $('#energy-chart');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    // Keep alpha but avoid `desynchronized`, which WebView2 promotes to an
    // opaque surface and makes the energy graph render as a solid rectangle.
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return null;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { context, width: rect.width, height: rect.height };
  }

  function energyDateLabel(dateStr) {
    if (!dateStr || dateStr.length < 10) return String(dateStr || '').slice(-2);
    const d = new Date(`${dateStr}T00:00:00+09:00`);
    if (isNaN(d.getTime())) return String(dateStr).slice(-2);
    const weekdays = T('weekdayNamesShort') || fallbackWeekdaysShort;
    return `${d.getMonth() + 1}/${d.getDate()}(${weekdays[d.getDay()] || ''})`;
  }

  function drawEnergyChart(items = energyHistory) {
    energyHistory = Array.isArray(items) ? items : [];
    const surface = energyCanvas();
    if (!surface) return;

    const { context, width, height } = surface;
    context.clearRect(0, 0, width, height);
    if (!energyHistory.length || width < 20 || height < 20) return;

    const values = energyHistory.map(item => finite(item.value) ? Number(item.value) : 0);
    const maximum = Math.max(1, ...values);
    const top = 11;
    const bottom = Math.max(top + 4, height - 17);
    const plotHeight = bottom - top;
    const step = width / energyHistory.length;
    const barWidth = Math.max(2, step * 0.72);

    context.textAlign = 'center';
    context.textBaseline = 'bottom';
    context.font = '600 7px sans-serif';
    values.forEach((value, index) => {
      const barHeight = Math.max(0, value / maximum * plotHeight);
      const x = index * step + (step - barWidth) / 2;
      const y = bottom - barHeight;
      context.fillStyle = 'rgba(255,184,48,.78)';
      context.fillRect(x, y, barWidth, barHeight);
      context.strokeStyle = 'rgba(255,210,120,.95)';
      context.lineWidth = 1;
      context.strokeRect(x + .5, y + .5, Math.max(0, barWidth - 1), Math.max(0, barHeight - 1));
      if (value > 0) {
        context.fillStyle = 'rgba(255,255,255,.75)';
        context.fillText(value >= 10 ? value.toFixed(0) : value.toFixed(1), x + barWidth / 2, Math.max(8, y - 2));
      }
    });

    context.textBaseline = 'top';
    context.font = '7px sans-serif';
    context.fillStyle = 'rgba(255,255,255,.5)';
    energyHistory.forEach((item, index) => {
      context.fillText(energyDateLabel(String(item.date || '')), index * step + step / 2, bottom + 3);
    });
  }

  function costLabel(kwh) {
    if (!finite(kwh) || Number(kwh) <= 0) return '';
    return `≈¥${Math.round(Number(kwh) * kwhUnitYen).toLocaleString()}`;
  }

  function renderEnergy(octopus = {}) {
    text('#energy-status', statusLabel(octopus));
    const lastMonthKwh = octopus.lastMonth?.usage;
    const projectedKwh = octopus.thisMonth?.projectedUsage;
    text('#last-month', number(lastMonthKwh, 1));
    text('#projected', number(projectedKwh, 1));
    text('#last-month-cost', costLabel(lastMonthKwh));
    text('#projected-cost', costLabel(projectedKwh));
    drawEnergyChart(Array.isArray(octopus.history) ? octopus.history.slice(-10) : []);
  }

  root.panels = root.panels || {};
  root.panels.energy = { renderEnergy, drawEnergyChart };
})();
