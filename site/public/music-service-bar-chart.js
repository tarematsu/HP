import { byId, integerFormat, safeInteger, svgElement } from './dashboard-ui-common.js';

// Current-value comparisons deliberately do not imply a history we don't collect.
export function renderMusicBarComparison(containerId, rows, unit = '') {
  const container = byId(containerId);
  if (!container) return;
  container.replaceChildren();
  const values = rows.map(row => ({ name: String(row.name || ''), value: safeInteger(row.value) })).filter(row => row.value != null && row.value >= 0);
  if (!values.length) {
    const empty = document.createElement('p');
    empty.className = 'shared-empty'; empty.textContent = '比較データがありません。'; container.append(empty); return;
  }
  const width = Math.max(240, container.getBoundingClientRect?.().width || 360);
  const visible = values.slice(0, 15);
  const height = 30 + visible.length * 42;
  const svg = svgElement('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${unit}の現在値比較`, class: 'music-service-bar-chart' });
  const left = Math.min(135, width * .4), right = 100;
  const max = Math.max(1, ...visible.map(row => row.value));
  for (const [index, row] of visible.entries()) {
    const y = 20 + index * 42;
    const label = svgElement('text', { x: 0, y: y + 14 }, row.name.length > 9 ? `${row.name.slice(0, 8)}…` : row.name);
    label.append(svgElement('title', {}, row.name));
    svg.append(label, svgElement('rect', { x: left, y, width: Math.max(0, row.value / max * Math.max(1, width - left - right)), height: 18, fill: '#17384f' }), svgElement('text', { x: width - 2, y: y + 14, 'text-anchor': 'end' }, integerFormat.format(row.value)));
  }
  container.append(svg);
}
