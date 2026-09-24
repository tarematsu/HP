import assert from 'node:assert/strict';
import test from 'node:test';

import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';

test('Actions R2 key remains deterministic', () => {
  assert.equal(pagesActionsR2ResponseKey('history:daily'), 'pages-response/actions-v2/686973746f72793a6461696c79.json');
});
