// Rank chart, missing bands, legend, pointer details and resize lifecycle.
import { byId, cssColor, integerFormat as numberFormat, shortDate } from '../dashboard-ui-common.js?v=20261004.1';
import { rankValue } from './format.js';
import {
  dashboardTickIndexes,
  drawDashboardGrid,
  drawDashboardLine,
  drawDashboardXAxis,
  prepareDashboardCanvas,
} from '../dashboard-chart-canvas.js?v=20261001.2';
import {
  DASHBOARD_MISSING_KEY,
  dashboardMissingIndexBands,
  drawDashboardMissingBands,
  nearestPositionIndex,
  observeDashboardChartResize,
} from '../dashboard-chart-runtime.js?v=20261001.1';

const FALLBACK_COLORS = Object.freeze(['#111111', '#667287', '#2776b9', '#168b73', '#c56a18', '#812990']);

export function createLeaderboardChart() {
  let currentPayload = null;
  let chartModel = null;
  let selectedIndex = null;
  let bound = false;

  function seriesColor(series, index) {
    return String(series?.color || '').trim() || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
  }

  function chartSeries(payload) {
    return (Array.isArray(payload?.series) ? payload.series : [])
      .map((series) => ({
        ...series,
        points: (Array.isArray(series?.points) ? series.points : [])
          .map((point) => ({ date: String(point?.date || ''), rank: rankValue(point?.rank) }))
          .filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.date))
          .sort((a, b) => a.date.localeCompare(b.date)),
      }));
  }

  function setChartEmpty(empty) {
    const panel = byId('leaderboardChartPanel');
    const canvas = byId('leaderboardChart');
    const message = byId('leaderboardChartEmpty');
    if (panel) panel.hidden = Boolean(empty);
    if (canvas) canvas.hidden = Boolean(empty);
    if (message) message.hidden = !empty;
    if (empty) {
      currentPayload = null;
      chartModel = null;
      selectedIndex = null;
      const detail = byId('leaderboardChartDetail');
      if (detail) detail.textContent = '';
    }
  }

  function appendLegendEntry(legend, labelText, color, { filled = false } = {}) {
    const entry = document.createElement('span');
    entry.className = 'leaderboard-legend-item';
    const swatch = document.createElement('i');
    swatch.className = 'leaderboard-legend-swatch';
    if (filled) swatch.style.backgroundColor = color;
    else swatch.style.borderTopColor = color;
    swatch.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = labelText;
    entry.append(swatch, label);
    legend.append(entry);
  }

  function renderLegend(series, hasMissingBand = false) {
    const legend = byId('leaderboardLegend');
    if (!legend) return;
    legend.replaceChildren();
    series.forEach((item, index) => appendLegendEntry(
      legend,
      item.label || item.id || '-',
      seriesColor(item, index),
    ));
    if (hasMissingBand) appendLegendEntry(legend, '欠測', DASHBOARD_MISSING_KEY, { filled: true });
  }

  function dateIsMissing(payload, date) {
    return (Array.isArray(payload?.missing_ranges) ? payload.missing_ranges : []).some((range) => {
      const from = String(range?.from || '');
      const to = String(range?.to || '');
      return /^\d{4}-\d{2}-\d{2}$/.test(from)
        && /^\d{4}-\d{2}-\d{2}$/.test(to)
        && date >= from
        && date <= to;
    });
  }

  function renderChartDetail() {
    const detail = byId('leaderboardChartDetail');
    if (!detail) return;
    if (!Number.isInteger(selectedIndex) || !chartModel?.dates?.[selectedIndex]) {
      detail.textContent = '';
      return;
    }
    const date = chartModel.dates[selectedIndex];
    const values = chartModel.series.map((series) => {
      const point = series.byDate.get(date);
      return `${series.label || series.id} ${point?.rank == null ? '圏外' : `${numberFormat.format(point.rank)}位`}`;
    });
    detail.textContent = `${date}　${values.join('　')}`;
  }

  function renderChart(payload) {
    currentPayload = payload;
    const series = chartSeries(payload);
    renderLegend(series);
    if (!series.length) {
      setChartEmpty(true);
      return;
    }
    setChartEmpty(false);
    const dates = [...new Set(series.flatMap((item) => item.points.map((point) => point.date)))].sort();
    const ranks = series.flatMap((item) => item.points.map((point) => point.rank).filter((rank) => rank != null));
    if (!dates.length || !ranks.length) {
      setChartEmpty(true);
      return;
    }

    const canvas = byId('leaderboardChart');
    const prepared = prepareDashboardCanvas(canvas, {
      minimumWidth: 320,
      minimumHeight: 260,
      fallbackWidth: 960,
      fallbackHeight: 360,
    });
    if (!prepared) return;
    const { context, width, height } = prepared;
    const area = { left: 52, right: 20, top: 20, bottom: 46 };
    area.width = Math.max(1, width - area.left - area.right);
    area.height = Math.max(1, height - area.top - area.bottom);
    const positions = dates.map((_, index) => area.left
      + (dates.length === 1 ? area.width / 2 : area.width * index / (dates.length - 1)));
    const step = positions.length > 1 ? area.width / (positions.length - 1) : area.width;
    const hasMissingBand = drawDashboardMissingBands(
      context,
      dashboardMissingIndexBands(dates, positions, area, {
        isMissing: (date) => dateIsMissing(payload, date),
        step,
      }),
      { top: area.top, height: area.height },
    );
    const maxRank = Math.max(1, ...ranks);
    const yFor = (rank) => area.top + (Math.max(1, Number(rank)) - 1) / Math.max(1, maxRank - 1) * area.height;

    context.fillStyle = cssColor('--muted', '#667287');
    context.font = '11px system-ui';
    context.textBaseline = 'middle';
    for (const { ratio, y } of drawDashboardGrid(context, {
      left: area.left,
      right: area.right,
      top: area.top,
      height: area.height,
      width,
      ticks: 3,
    })) {
      const rank = Math.max(1, Math.round(1 + (maxRank - 1) * ratio));
      context.textAlign = 'right';
      context.fillText(`#${numberFormat.format(rank)}`, area.left - 7, y);
    }

    const normalizedSeries = series.map((item, index) => {
      const byDate = new Map(item.points.map((point) => [point.date, point]));
      const rows = dates.map((date) => ({ date, rank: byDate.get(date)?.rank ?? null }));
      const color = seriesColor(item, index);
      drawDashboardLine(context, rows, {
        x: (row) => positions[dates.indexOf(row.date)],
        y: (rank) => yFor(rank),
        value: (row) => row.rank,
        valid: (rank) => rank != null,
        strokeStyle: color,
        lineWidth: 2,
      });
      rows.forEach((row, rowIndex) => {
        if (row.rank == null) return;
        context.save();
        context.fillStyle = color;
        context.beginPath();
        context.arc(positions[rowIndex], yFor(row.rank), 3, 0, Math.PI * 2);
        context.fill();
        context.restore();
      });
      return { ...item, byDate };
    });

    renderLegend(series, hasMissingBand);
    drawDashboardXAxis(context, {
      left: area.left,
      right: area.right,
      top: area.top + area.height,
      width,
      positions,
      indexes: dashboardTickIndexes(dates.length, width < 520 ? 4 : 6),
      labelFor: (index) => shortDate(dates[index]),
      fillStyle: cssColor('--muted', '#667287'),
    });

    chartModel = { dates, positions, series: normalizedSeries };
    renderChartDetail();
  }

  function bindInteractions() {
    if (bound) return;
    bound = true;
    const canvas = byId('leaderboardChart');
    canvas?.addEventListener('pointerup', (event) => {
      if (!chartModel?.positions?.length) return;
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width) return;
      selectedIndex = nearestPositionIndex(chartModel.positions, event.clientX - bounds.left);
      renderChartDetail();
    });
    observeDashboardChartResize(canvas, () => {
      if (currentPayload) renderChart(currentPayload);
    }, { delay: 180, enabled: () => Boolean(currentPayload?.series?.length) });
  }


  return { renderChart, setChartEmpty, bindInteractions, resetSelection() { selectedIndex = null; } };
}
