(() => {
  'use strict';

  const nativeGetContext = HTMLCanvasElement.prototype.getContext;
  if (nativeGetContext.__homePanelTransparentCharts) return;

  const chartIds = new Set(['air-history-chart', 'energy-chart']);
  const maxScale = 1.25;
  const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width');
  const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'height');
  const nativeSetTransform = CanvasRenderingContext2D.prototype.setTransform;

  const clampedDimension = (canvas, value, axis) => {
    if (!chartIds.has(canvas.id)) return value;
    const rect = canvas.getBoundingClientRect();
    const cssSize = axis === 'width' ? rect.width : rect.height;
    if (!Number.isFinite(cssSize) || cssSize <= 0) return value;
    return Math.min(Number(value) || 0, Math.max(1, Math.round(cssSize * maxScale)));
  };

  if (widthDescriptor?.get && widthDescriptor?.set && widthDescriptor.configurable) {
    Object.defineProperty(HTMLCanvasElement.prototype, 'width', {
      ...widthDescriptor,
      set(value) { widthDescriptor.set.call(this, clampedDimension(this, value, 'width')); },
    });
  }
  if (heightDescriptor?.get && heightDescriptor?.set && heightDescriptor.configurable) {
    Object.defineProperty(HTMLCanvasElement.prototype, 'height', {
      ...heightDescriptor,
      set(value) { heightDescriptor.set.call(this, clampedDimension(this, value, 'height')); },
    });
  }

  CanvasRenderingContext2D.prototype.setTransform = function(...args) {
    if (chartIds.has(this.canvas?.id) && args.length >= 6 &&
        Number(args[0]) > maxScale && Number(args[3]) > maxScale &&
        Number(args[1]) === 0 && Number(args[2]) === 0) {
      args[0] = maxScale;
      args[3] = maxScale;
    }
    return nativeSetTransform.apply(this, args);
  };

  function getContext(type, attributes) {
    if (type === '2d' && chartIds.has(this.id)) {
      const options = { ...(attributes || {}), alpha: true };
      delete options.desynchronized;
      this.style.background = 'transparent';
      this.style.backgroundColor = 'transparent';
      return nativeGetContext.call(this, type, options);
    }
    return nativeGetContext.call(this, type, attributes);
  }

  getContext.__homePanelTransparentCharts = true;
  HTMLCanvasElement.prototype.getContext = getContext;
})();
