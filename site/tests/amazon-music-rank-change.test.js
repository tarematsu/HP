import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shell = readFileSync(new URL('../public/amazon-music-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/amazon-music.js', import.meta.url), 'utf8');
const sharedUi = readFileSync(new URL('../public/dashboard-ui-common.js', import.meta.url), 'utf8');

test('Amazon Music table exposes artist and previous-day rank change columns', () => {
  assert.match(shell, /headers: \['Amazon Music総合順位', '前日比', 'アーティスト', '曲名'\]/);
  assert.match(runtime, /signedInteger\(track\?\.rank_change\)/);
  assert.match(runtime, /artist\.textContent = track\?\.group_name \|\| '-'/);
  assert.match(sharedUi, /export function signedInteger\(/);
  assert.match(sharedUi, /parsed > 0 \? '\+' : ''/);
});
