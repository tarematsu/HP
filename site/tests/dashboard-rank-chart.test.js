import assert from 'node:assert/strict';
import test from 'node:test';

import { renderRankHistoryChart } from '../public/dashboard-rank-chart.js';

class FakeStyle {
  constructor() { this.values = new Map(); }
  setProperty(name, value) { this.values.set(name, String(value)); }
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
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
}

globalThis.document = {
  createElement(tagName) { return new FakeNode(tagName); },
  createElementNS(_namespace, tagName) { return new FakeNode(tagName); },
};

test('shared rank chart renders grid, dates, paths and latest points', () => {
  const container = new FakeNode('div');
  const svg = renderRankHistoryChart({
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
    gridClass: 'rank-grid',
    axisClass: 'rank-axis',
    lineClass: 'rank-line',
    pointClass: 'rank-point',
    hueVariable: '--rank-hue',
    rankLabel: (rank) => `${rank}位`,
    dateLabel: (date) => date.slice(5),
    lineTitle: (item) => item.title,
    latestPoint: {
      radius: () => 3,
      title: (item, point) => `${item.title} ${point.rank}位`,
    },
  });

  assert.equal(container.children[0], svg);
  assert.equal(svg.children.filter((node) => node.tagName === 'LINE').length, 3);
  assert.equal(svg.children.filter((node) => node.tagName === 'TEXT').length, 5);
  const path = svg.children.find((node) => node.tagName === 'PATH');
  assert.match(path.attributes.get('d'), /^M .+ L /);
  assert.equal(path.style.values.get('--rank-hue'), '0');
  assert.equal(path.children[0].textContent, '曲A');
  const point = svg.children.find((node) => node.tagName === 'CIRCLE');
  assert.equal(point.attributes.get('r'), '3');
  assert.equal(point.children[0].textContent, '曲A 2位');
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
