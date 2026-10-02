import { appendEmptyState } from './dashboard-ui-common.js?v=20260930.1';
import {
  dashboardTickIndexes,
  drawDashboardGrid,
  drawDashboardLine,
  prepareDashboardCanvas,
} from './dashboard-chart-canvas.js?v=20261001.2';
import { observeDashboardChartResize } from './dashboard-chart-runtime.js?v=20261001.1';

const states = new WeakMap();
const observedContainers = new WeakSet();

function textAnchor(index, length) {
  if (index === 0) return 'left';
  if (index === length - 1) return 'right';
  return 'center';
}

function seriesColor(lineClass, seriesIndex, hueStep, alpha = 1) {
  const hue = (seriesIndex * hueStep) % 360;
  const saturation = String(lineClass || '').includes('apple') ? 68 : 55;
  return `hsl(${hue} ${saturation}% 48% / ${alpha})`;
}

function paint(options) {
  const {
    container,
    series = [],
    dates = [],
    height = 400,
    margin = { left: 56, right: 18, top: 18, bottom: 38 },
    yMax,
    rankTicks = [],
    dateTickCount = 5,
    ariaLabel = '',
    svgClass = '',
    lineClass = '',
    emptyClass = 'shared-empty',
    emptyText = '順位履歴はまだありません。',
    rankLabel = (rank) => `${rank}位`,
    dateLabel = (date) => date,
    hueStep = 47,
    latestPoint = null,
    legendContainer = null,
  } = options;
  if (!container) return null;
  if (legendContainer) {
    legendContainer.replaceChildren(...series.map((item, index) => {
      const label = document.createElement('span');
      const dot = document.createElement('i');
      dot.style.background = item?.color || seriesColor(lineClass, index, hueStep);
      label.append(dot, `${item.title}${item.currentRank == null ? '' : ` ${item.currentRank}位`}`);
      return label;
    }));
  }
  container.replaceChildren();
  const ceiling = Number(yMax);
  if (!series.length || !dates.length || !Number.isFinite(ceiling) || ceiling <= 1) {
    appendEmptyState(container, emptyText, { className: emptyClass });
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.className = `${svgClass} shared-dashboard-canvas`.trim();
  canvas.setAttribute('role', 'img');
  if (ariaLabel) canvas.setAttribute('aria-label', ariaLabel);
  container.append(canvas);
  const measuredWidth = Math.max(1, Math.round(container.getBoundingClientRect?.().width || container.clientWidth || 960));
  const targetHeight = measuredWidth < 520
    ? Math.max(260, Math.min(320, Math.round(measuredWidth * .78)))
    : Math.max(300, Math.min(height, Math.round(measuredWidth * .48)));
  const prepared = prepareDashboardCanvas(canvas, {
    minimumWidth: 1,
    minimumHeight: 1,
    fallbackWidth: measuredWidth,
    height: targetHeight,
  });
  if (!prepared) return null;
  const { context, width, height: canvasHeight } = prepared;
  const plotWidth = Math.max(1, width - margin.left - margin.right);
  const plotHeight = Math.max(1, canvasHeight - margin.top - margin.bottom);
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const xFor = (date) => {
    const index = dateIndex.get(date) ?? 0;
    return margin.left + (dates.length <= 1 ? plotWidth / 2 : index / (dates.length - 1) * plotWidth);
  };
  const yFor = (rank) => margin.top + (rank - 1) / Math.max(1, ceiling - 1) * plotHeight;

  context.font = '500 11px system-ui';
  context.fillStyle = '#667287';
  context.textBaseline = 'middle';
  const grid = drawDashboardGrid(context, {
    left: margin.left,
    right: margin.right,
    top: margin.top,
    height: plotHeight,
    width,
    ratios: rankTicks.map((rank) => (Number(rank) - 1) / Math.max(1, ceiling - 1)),
  });
  grid.forEach(({ index, y }) => {
    const rank = rankTicks[index];
    if (rank == null) return;
    context.textAlign = 'right';
    context.fillText(rankLabel(rank), margin.left - 8, y);
  });

  context.textBaseline = 'alphabetic';
  const dateTicks = dashboardTickIndexes(dates.length, dateTickCount);
  for (const index of dateTicks) {
    context.textAlign = textAnchor(index, dates.length);
    context.fillText(dateLabel(dates[index]), xFor(dates[index]), canvasHeight - 10);
  }

  series.forEach((item, seriesIndex) => {
    const byDate = new Map((item.points || []).map((point) => [point.date, point]));
    const rows = dates.map((date) => ({ date, rank: Number(byDate.get(date)?.rank) }));
    const color = item?.color || seriesColor(lineClass, seriesIndex, hueStep, String(lineClass).includes('amazon') ? .48 : .92);
    drawDashboardLine(context, rows, {
      x: (row) => xFor(row.date),
      y: (rank) => yFor(rank),
      value: (row) => row.rank,
      valid: (rank) => Number.isFinite(rank),
      strokeStyle: color,
      lineWidth: 2,
    });

    if (!latestPoint) return;
    const latest = (item.points || []).filter((point) => Number.isFinite(point?.rank)).at(-1);
    if (!latest) return;
    context.save();
    context.fillStyle = item?.color || seriesColor(lineClass, seriesIndex, hueStep, .9);
    context.beginPath();
    context.arc(
      xFor(latest.date),
      yFor(latest.rank),
      latestPoint.radius?.(item, latest) ?? 2.5,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.restore();
  });

  states.set(container, { options, lastWidth: width });
  return canvas;
}

function ensureResizeObserver(container) {
  if (!container || observedContainers.has(container)) return;
  observeDashboardChartResize(container, () => {
    const state = states.get(container);
    if (state) paint(state.options);
  }, { delay: 120, enabled: () => Boolean(states.get(container)) });
  observedContainers.add(container);
}

export function renderRankHistoryChart(options = {}) {
  const container = options?.container;
  if (!container) return null;
  const result = paint(options);
  ensureResizeObserver(container);
  return result;
}
