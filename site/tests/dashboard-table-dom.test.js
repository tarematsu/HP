import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendTableRow,
  replaceTableHeader,
} from '../public/dashboard-table-dom.js';

class FakeNode {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.textContent = '';
    this.scope = '';
    this.className = '';
    this.colSpan = 1;
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = [...nodes];
  }
}

globalThis.document = {
  createElement(tagName) {
    return new FakeNode(tagName);
  },
};

test('shared table DOM helper appends ordinary value rows', () => {
  const container = new FakeNode('tbody');
  const row = appendTableRow(container, ['a', 2, null]);
  assert.equal(row.tagName, 'TR');
  assert.equal(container.children[0], row);
  assert.deepEqual(row.children.map((cell) => cell.textContent), ['a', '2', '']);
});

test('shared table DOM helper preserves custom nodes and cell presentation', () => {
  const container = new FakeNode('tbody');
  const button = new FakeNode('button');
  const row = appendTableRow(container, [
    { node: button, className: 'action-cell' },
    { text: '42', className: 'number-cell', colSpan: 2 },
  ], { className: 'summary-row' });
  assert.equal(row.className, 'summary-row');
  assert.equal(row.children[0].children[0], button);
  assert.equal(row.children[0].className, 'action-cell');
  assert.equal(row.children[1].className, 'number-cell');
  assert.equal(row.children[1].colSpan, 2);
  assert.equal(row.children[1].textContent, '42');
});

test('shared table DOM helper replaces scoped table headers', () => {
  const head = new FakeNode('thead');
  const row = replaceTableHeader(head, ['順位', '名前']);
  assert.equal(head.children[0], row);
  assert.deepEqual(row.children.map((cell) => cell.tagName), ['TH', 'TH']);
  assert.deepEqual(row.children.map((cell) => cell.scope), ['col', 'col']);
  assert.deepEqual(row.children.map((cell) => cell.textContent), ['順位', '名前']);
});
