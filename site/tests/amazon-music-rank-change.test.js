import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shell = readFileSync(new URL('../public/amazon-music-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/amazon-music.js', import.meta.url), 'utf8');
const sharedUi = readFileSync(new URL('../public/dashboard-ui-common.js', import.meta.url), 'utf8');
const tableDom = readFileSync(new URL('../public/dashboard-table-dom.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/amazon-music.css', import.meta.url), 'utf8');

test('Amazon Music table exposes artist and previous-day rank change columns', () => {
  assert.match(shell, /headers: \\['順位', '前日比', 'グループ', '曲名'\\]/);
  assert.match(runtime, /signedInteger\(track\?\.rank_change\)/);
  assert.match(runtime, /appendTableRow\(tbody, \[/);
  assert.match(runtime, /track\?\.group_name \|\| '-'/);
  assert.doesNotMatch(runtime, /document\.createElement\('tr'\)|row\.insertCell\(/);
  assert.match(tableDom, /export function appendTableRow\(/);
  assert.match(sharedUi, /export function signedInteger\(/);
  assert.match(sharedUi, /parsed > 0 \? '\+' : ''/);
});

test('Amazon Music mobile rank and group columns keep complete values on one line', () => {
  assert.match(css, /\.amazon-table :is\\(th, td\\)\.amazon-rank-number[\\s\\S]*?white-space:\\s*nowrap;[\\s\\S]*?overflow-wrap:\\s*normal;/);
  assert.match(css, /\.amazon-table td\\.amazon-artist-name[\\s\\S]*?white-space:\\s*nowrap;[\\s\\S]*?overflow-wrap:\\s*normal;/);
  assert.match(css, /\.amazon-table th:nth-child\\(3\\)[\\s\\S]*?white-space:\\s*nowrap;/);
});
