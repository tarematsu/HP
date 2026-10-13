import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRegionalFilters,
  regionalProviderDate,
  regionalProviderDateText,
  regionalRankChartOptions,
  renderRegionalServiceStatus,
} from '../public/music-service-regional-ui.js';

test('regional date parser preserves shared YYYY-MM-DD semantics', () => {
  assert.equal(regionalProviderDate('2026-10-14T11:00:00Z'), '2026-10-14');
  assert.equal(regionalProviderDate('2026-10-14'), '2026-10-14');
  assert.equal(regionalProviderDate('invalid'), '');
  assert.equal(regionalProviderDateText('2026-10-14T00:00:00Z'), '2026/10/14');
  assert.equal(regionalProviderDateText('invalid'), '-');
  assert.equal(regionalProviderDateText('invalid', '原文'), '原文');
});

test('regional controls share idempotent binding and accessible pressed state', () => {
  const previousDocument = globalThis.document;
  const clicks = new Map();
  const buttons = ['all', 'sakurazaka46'].map((value) => ({
    getAttribute: () => value,
    classList: {
      toggle(name, enabled) { this[name] = enabled; },
    },
    setAttribute(name, next) { if (name === 'aria-pressed') this.pressed = next; },
    addEventListener(name, fn) {
      assert.equal(name, 'click');
      assert.equal(clicks.has(value), false, 'each control binds only once');
      clicks.set(value, fn);
    },
  }));
  globalThis.document = { querySelectorAll: () => buttons };
  try {
    let selection = 'all';
    let updates = 0;
    const filter = createRegionalFilters([{
      attribute: 'example-artist',
      get: () => selection,
      set: (next) => { selection = next; },
    }], () => { updates++; });
    filter.bind();
    filter.bind();
    filter.sync();
    assert.equal(buttons[0].pressed, 'true');
    assert.equal(buttons[1].pressed, 'false');
    clicks.get('sakurazaka46')();
    assert.equal(selection, 'sakurazaka46');
    assert.equal(updates, 1);
    assert.equal(buttons[1].pressed, 'true');
    clicks.get('sakurazaka46')();
    assert.equal(updates, 1, 'already active selection does not rerender');
  } finally {
    globalThis.document = previousDocument;
  }
});

test('regional chart defaults preserve common rank and missing-rank semantics', () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById(id) { return { id }; },
  };
  try {
    const config = regionalRankChartOptions({
      containerId: 'plot', legendId: 'legend',
      series: [], dates: ['2026-10-14'], ariaLabel: 'テスト',
      emptyText: 'データなし', dateLabel: (value) => value,
    });
    assert.equal(config.container.id, 'plot');
    assert.equal(config.legendContainer.id, 'legend');
    assert.deepEqual(config.rankTicks, [1, 25, 50, 75, 101]);
    assert.equal(config.rankLabel(101), '圏外');
    assert.equal(config.rankLabel(2), '2位');
    assert.equal(config.height, 320);
  } finally {
    globalThis.document = previousDocument;
  }
});

