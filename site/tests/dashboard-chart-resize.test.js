import assert from 'node:assert/strict';
import test from 'node:test';
import { observeDashboardChartResize } from '../public/dashboard-chart-runtime.js';

test('width-only chart observation does not redraw on content height changes', async () => {
  const original = globalThis.ResizeObserver;
  let observer;
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observer = this; }
    observe() {}
    disconnect() {}
  };
  try {
    const target = { getClientRects: () => [{}] };
    let renders = 0;
    const stop = observeDashboardChartResize(target, () => { renders++; }, {
      delay: 1,
      watchHeight: false,
    });
    observer.callback([{ contentRect: { width: 320, height: 450 } }]);
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(renders, 1);
    observer.callback([{ contentRect: { width: 320, height: 120 } }]);
    observer.callback([{ contentRect: { width: 320, height: 500 } }]);
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(renders, 1, 'changing the table or empty-chart height cannot cause repaint loops');
    observer.callback([{ contentRect: { width: 400, height: 500 } }]);
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(renders, 2, 'a genuine chart width change must still redraw');
    stop();
  } finally {
    if (original === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = original;
  }
});
