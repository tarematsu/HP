import assert from 'node:assert/strict';
import test from 'node:test';

import { renderRankHistoryChart } from '../public/dashboard-rank-chart.js';

class FakeStyle {
  constructor() { this.values = new Map(); }
  setProperty(name, value) { this.values.set(name, String(value)); }
}

class FakeContext {
  constructor() { this.calls = []; }
  record(name, ...args) { this.calls.push([name, ...args]); }
  setTransform(...args) { this.record('setTransform', ...args); }
  clearRect(...args) { this.record('clearRect', ...args); }
  save() { this.record('save'); }
  restore() { this.record('restore'); }
  beginPath() { this.record('beginPath'); }
  moveTo(...args) { this.record('moveTo', ...args); }
  lineTo(...args) { this.record('lineTo', ...args); }
  stroke() { this.record('stroke'); }
  fillText(...args) { this.record('fillText', ...args); }
  arc(...args) { this.record('arc', ...args); }
  fill() { this.record('fill'); }
}

class FakeNode {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.attributes = new Map();
    this.textContent = '';
    this.className = '';
    this.style = new FakeStyle();
    this.clientWidth = 960;
    this.clientHeight = 400;
    this.context = this.tagName === 'CANVAS' ? new FakeContext() : null;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  append(...nodes) {
    for (const node of nodes) {
      if (node && typeof node === 'object') {
        node.parentElement = this;
        if (node.tagName === 'CANVAS') node.clientWidth = this.clientWidth;
      }
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  getBoundingClientRect() { return { width: this.clientWidth, height: this.clientHeight }; }
  getContext(kind) { return kind === '2d' ? this.context : null; }
}

globalThis.window = { devicePixelRatio: 1 };
globalThis.document = {
  createElement(tagName) { return new FakeNode(tagName); },
};

test('shared rank chart renders grid, dates, lines and latest points on the dashboard canvas', () => {
  const container = new FakeNode('div');
  const canvas = renderRankHistoryChart({
    container,
    series: [{
      title: '曲A',
      currentRank: 2,
      points: [
        { date: '2026-09-29', rank: 3 },
        { date: '2026-09-30', rank: 2 },
      ],
    }],
    dates: ['2026-09-29', '2026-09-30'],
    yMax: 5,
    rankTicks: [1, 3, 5],
    dateTickCount: 2,
    lineClass: 'rank-line',
    rankLabel: (rank) => `${rank}位`,
    dateLabel: (date) => date.slice(5),
    latestPoint: { radius: () => 3 },
  });

  assert.equal(container.children[0], canvas);
  assert.equal(canvas.tagName, 'CANVAS');
  assert.match(canvas.className, /shared-dashboard-canvas/);
  const calls = canvas.context.calls;
  assert.ok(calls.some(([name]) => name === 'lineTo'));
  assert.ok(calls.some(([name, text]) => name === 'fillText' && text === '1位'));
  assert.ok(calls.some(([name, text]) => name === 'fillText' && text === '09-29'));
  assert.ok(calls.some(([name, , , radius]) => name === 'arc' && radius === 3));
});

test('shared rank chart thins date labels when the canvas is narrow', () => {
  const container = new FakeNode('div');
  container.clientWidth = 300;
  const dates = ['2021-01-01','2022-01-01','2023-01-01','2024-01-01','2025-01-01'];
  const canvas = renderRankHistoryChart({
    container,
    series: [{
      title: '曲A',
      points: dates.map((date, index) => ({ date, rank:index + 1 })),
    }],
    dates,
    yMax: 5,
    rankTicks: [1, 3, 5],
    dateTickCount: 5,
    dateLabel: (date) => date.replaceAll('-', '/'),
  });

  const labels = canvas.context.calls
    .filter(([name, text]) => name === 'fillText' && /^202\d\//.test(String(text)))
    .map(([, text]) => text);
  assert.ok(labels.length < 5);
  assert.equal(labels[0], '2021/01/01');
  assert.equal(labels.at(-1), '2025/01/01');
});

test('shared rank chart renders the configured empty state', () => {
  const container = new FakeNode('div');
  const result = renderRankHistoryChart({
    container,
    series: [],
    dates: [],
    yMax: 5,
    emptyClass: 'rank-empty',
    emptyText: '履歴なし',
  });
  assert.equal(result, null);
  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].className, 'rank-empty');
  assert.equal(container.children[0].textContent, '履歴なし');
});
