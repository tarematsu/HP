import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shell = readFileSync(new URL('../public/amazon-music-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/amazon-music.js', import.meta.url), 'utf8');

test('Amazon Music table exposes the previous-day column and signed rank change', () => {
  assert.match(shell, /headers: \['Amazon Music総合順位', '前日比', '曲名'\]/);
  assert.match(runtime, /track\?\.rank_change/);
  assert.match(runtime, /`\+\$\{numberFormat\.format\(delta\)\}`/);
});
