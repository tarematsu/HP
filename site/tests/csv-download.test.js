import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { csvCell, csvText } from '../public/csv-download.js';

const likes = readFileSync(new URL('../public/history/history-likes.js', import.meta.url), 'utf8');
const allHosts = readFileSync(new URL('../public/history/history-ranking-all-host-table.js', import.meta.url), 'utf8');
const history = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');
const nogizaka = readFileSync(new URL('../public/nogizaka-listening-party.js', import.meta.url), 'utf8');

test('CSV encoder preserves the previous quoted export format', () => {
  assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(csvText([['順位', '曲名'], [1, 'a,b']], { bom: false }), '"順位","曲名"\n"1","a,b"');
});

test('CSV encoder supports minimally quoted rows for remaining legacy exports', () => {
  assert.equal(csvText([['plain', 'a,b', 'a"b']], { bom: false, quoteAll: false }), 'plain,"a,b","a""b"');
  assert.equal(csvText([['a', 'b']], { trailingNewline: true }), '\uFEFF"a","b"\n');
});

test('CSV consumers reuse the shared downloader instead of Blob/ObjectURL plumbing', () => {
  for (const source of [likes, allHosts, history, nogizaka]) {
    assert.match(source, /csv-download\.js\?v=20261001\.1/);
    assert.match(source, /downloadCsv\(/);
    assert.doesNotMatch(source, /new Blob\(|URL\.createObjectURL|text\/csv;charset=utf-8/);
  }
  assert.match(nogizaka, /quoteAll: false/);
  assert.match(nogizaka, /trailingNewline: true/);
  assert.doesNotMatch(nogizaka, /function csvValue\(/);
});
