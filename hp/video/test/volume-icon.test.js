import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const styles = await readFile(new URL('../public/volume-icon.css', import.meta.url), 'utf8');

test('monochrome volume icon stylesheet is loaded', () => {
  assert.match(index, /href="\/volume-icon\.css"/);
});

test('volume emoji glyph is visually replaced by currentColor masks', () => {
  assert.match(styles, /#muteButton span \{/);
  assert.match(styles, /font-size:\s*0/);
  assert.match(styles, /background:\s*currentColor/);
  assert.match(styles, /#muteButton\[aria-label="ミュート"\]/);
  assert.match(styles, /#muteButton\[aria-label="ミュート解除"\]/);
  assert.match(styles, /mask-image:/);
});
