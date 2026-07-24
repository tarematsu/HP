import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const index = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../public/landscape-controls.css', import.meta.url), 'utf8');

test('landscape tap feedback stylesheet is loaded', () => {
  assert.match(index, /href="\/landscape-controls\.css"/);
});

test('landscape double tap feedback has top and bottom positions', () => {
  assert.match(styles, /@media \(orientation: landscape\)/);
  assert.match(styles, /#tapFeedback\[data-side="top"\]/);
  assert.match(styles, /#tapFeedback\[data-side="bottom"\]/);
});
