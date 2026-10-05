import { browserSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { csvCell, csvText } from '../public/csv-download.js';

const likes = browserSource('stationhead/likes.js');
const history = browserSource('history/history-lite.js');
const stationhead = browserSource('stationhead-channel.js');

test('CSV encoder preserves the previous quoted export format', () => {
  assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(csvText([['順位', '曲名'], [1, 'a,b']], { bom: false }), '"順位","曲名"\n"1","a,b"');
});

test('CSV encoder supports minimally quoted rows for remaining legacy exports', () => {
  assert.equal(csvText([['plain', 'a,b', 'a"b']], { bom: false, quoteAll: false }), 'plain,"a,b","a""b"');
  assert.equal(csvText([['a', 'b']], { trailingNewline: true }), '\uFEFF"a","b"\n');
});

test('active CSV consumers reuse the shared downloader instead of Blob/ObjectURL plumbing', () => {
  for (const source of [likes, history, stationhead]) {
    assert.match(source, /csv-download\.js\?v=20261001\.1/);
    assert.match(source, /downloadCsv\(/);
    assert.doesNotMatch(source, /new Blob\(|URL\.createObjectURL|text\/csv;charset=utf-8/);
  }
  assert.match(stationhead, /like-ranking-/);
  assert.doesNotMatch(stationhead, /function csvValue\(/);
});
