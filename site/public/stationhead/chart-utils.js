// Canvas sizing, grid and labels shared by channel charts.
import { prepareDashboardCanvas } from '../dashboard-chart-canvas.js?v=20261001.2';
import { integerFormat as integer } from '../dashboard-ui-common.js?v=20261004.1';

export function setupCanvas(canvas, fallbackHeight = 360) {
  if (!canvas) return null;
  const width = Math.max(320, Math.round(canvas.getBoundingClientRect().width || canvas.clientWidth || 960));
  return prepareDashboardCanvas(canvas, { minimumWidth: 320, minimumHeight: 240, fallbackWidth: width, height: Math.max(260, fallbackHeight) });
}

export function drawGrid(context, width, area, maximum, minimum = 0) {
  context.strokeStyle = 'rgba(100,110,125,.18)';
  context.fillStyle = '#667287';
  context.font = '11px system-ui';
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  for (let index = 0; index <= 4; index += 1) {
    const ratio = index / 4;
    const y = area.top + area.height * ratio;
    context.beginPath(); context.moveTo(area.left, y); context.lineTo(width - area.right, y); context.stroke();
    context.fillText(integer.format(Math.round(maximum - (maximum - minimum) * ratio)), area.left - 6, y);
  }
}

export function labelBox(context, text, x, y, align, width, height) {
  context.save(); context.font = '600 11px system-ui';
  const boxWidth = context.measureText(text).width + 10; const boxHeight = 18;
  let left = align === 'right' ? x - boxWidth : x;
  left = Math.max(2, Math.min(width - boxWidth - 2, left));
  const top = Math.max(2, Math.min(height - boxHeight - 2, y - boxHeight / 2));
  context.fillStyle = 'rgba(255,255,255,.92)'; context.fillRect(left, top, boxWidth, boxHeight);
  context.fillStyle = '#111'; context.textAlign = 'left'; context.textBaseline = 'middle'; context.fillText(text, left + 5, top + boxHeight / 2); context.restore();
}
