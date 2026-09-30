import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendTableRow,
  createTableHeaderRow,
  createTableRow,
} from '../public/dashboard-table-dom.js';

class FakeNode {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.dataset = {};
    this.className = '';
    this.textContent = '';
    this.scope = '';
    this.title = '';
    this.colSpan = 1;
  }

  append(...nodes) {
    this.children.push(...nodes);
  }
}

globalThis.document = {
  createElement(tagName) {
    return new FakeNode(tagName);
  },
};

test('shared table DOM helper creates ordinary value rows', () => {
  const row = createTableRow(['a', 2, null], { className: 'sample', dataset: { key: 'x' } });
  assert.equal(row.tagName, 'TR');
  assert.equal(row.className, 'sample');
  assert.equal(row.dataset.key, 'x');
  assert.deepEqual(row.children.map((cell) => cell.textContent), ['a', '2', '']);
});

test('shared table DOM helper creates scoped headers and node cells', () => {
  const header = createTableHeaderRow(['順位', { text: '名前', title: '表示名' }]);
  assert.deepEqual(header.children.map((cell) => cell.tagName), ['TH', 'TH']);
  assert.deepEqual(header.children.map((cell) => cell.scope), ['col', 'col']);
  assert.equal(header.children[1].title, '表示名');

  const button = new FakeNode('button');
  const row = createTableRow([{ node: button }]);
  assert.equal(row.children[0].children[0], button);
});

test('appendTableRow appends the generated row to a container', () => {
  const container = new FakeNode('tbody');
  const row = appendTableRow(container, ['x']);
  assert.equal(container.children[0], row);
});
