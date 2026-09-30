import {
  appendEmptyState,
  evenlySpacedIndexes,
  svgElement,
} from './dashboard-ui-common.js?v=20260930.1';

function textAnchor(index, length) {
  if (index === 0) return 'start';
  if (index === length - 1) return 'end';
  return 'middle';
}

export function renderRankHistoryChart({
  container,
  series = [],
  dates = [],
  width = 960,
  height = 400,
  margin = { left: 56, right: 18, top: 18, bottom: 38 },
  yMax,
  rankTicks = [],
  dateTickCount = 5,
  ariaLabel = '',
  svgClass = '',
  gridClass = '',
  axisClass = '',
  lineClass = '',
  pointClass = '',
  emptyClass = 'shared-empty',
  emptyText = '順位履歴はまだありません。',
  rankLabel = (rank) => `${rank}位`,
  dateLabel = (date) => date,
  hueVariable = '',
  hueStep = 47,
  lineTitle = (item) => item?.title || '',
  latestPoint = null,
} = {}) {
  if (!container) return null;
  container.replaceChildren();
  const ceiling = Number(yMax);
  if (!series.length || !dates.length || !Number.isFinite(ceiling) || ceiling <= 1) {
    appendEmptyState(container, emptyText, { className: emptyClass });
    return null;
  }

  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const xFor = (date) => {
    const index = dateIndex.get(date) ?? 0;
    return margin.left + (dates.length <= 1 ? plotWidth / 2 : index / (dates.length - 1) * plotWidth);
  };
  const yFor = (rank) => margin.top + (rank - 1) / Math.max(1, ceiling - 1) * plotHeight;
  const svg = svgElement('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': ariaLabel,
    class: svgClass,
  });

  for (const rank of rankTicks) {
    const y = yFor(rank);
    svg.append(svgElement('line', {
      x1: margin.left,
      y1: y,
      x2: width - margin.right,
      y2: y,
      class: gridClass,
    }));
    svg.append(svgElement('text', {
      x: margin.left - 8,
      y: y + 4,
      'text-anchor': 'end',
      class: axisClass,
    }, rankLabel(rank)));
  }

  for (const index of evenlySpacedIndexes(dates.length, dateTickCount)) {
    svg.append(svgElement('text', {
      x: xFor(dates[index]),
      y: height - Math.max(9, Math.round(margin.bottom * .26)),
      'text-anchor': textAnchor(index, dates.length),
      class: axisClass,
    }, dateLabel(dates[index])));
  }

  series.forEach((item, seriesIndex) => {
    let pathData = '';
    let previousIndex = null;
    for (const point of item.points || []) {
      if (!Number.isFinite(point?.rank)) {
        previousIndex = null;
        continue;
      }
      const currentIndex = dateIndex.get(point.date);
      const command = previousIndex != null && currentIndex === previousIndex + 1 ? 'L' : 'M';
      pathData += ` ${command} ${xFor(point.date).toFixed(2)} ${yFor(point.rank).toFixed(2)}`;
      previousIndex = currentIndex;
    }
    if (!pathData) return;
    const path = svgElement('path', { d: pathData.trim(), class: lineClass });
    if (hueVariable) path.style.setProperty(hueVariable, String((seriesIndex * hueStep) % 360));
    const title = lineTitle(item);
    if (title) path.append(svgElement('title', {}, title));
    svg.append(path);

    if (!latestPoint) return;
    const latest = (item.points || []).filter((point) => Number.isFinite(point?.rank)).at(-1);
    if (!latest) return;
    const point = svgElement('circle', {
      cx: xFor(latest.date),
      cy: yFor(latest.rank),
      r: latestPoint.radius?.(item, latest) ?? 2.5,
      class: pointClass,
    });
    if (hueVariable) point.style.setProperty(hueVariable, String((seriesIndex * hueStep) % 360));
    const pointTitle = latestPoint.title?.(item, latest);
    if (pointTitle) point.append(svgElement('title', {}, pointTitle));
    svg.append(point);
  });

  container.append(svg);
  return svg;
}
