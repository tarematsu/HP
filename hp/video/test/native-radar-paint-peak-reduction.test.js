import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const renderer = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url),
  'utf8',
);

test('radar paints reuse the cached source DC and avoid HALFTONE filtering', () => {
  const start = renderer.indexOf('void StretchRadarIntoLowPeak(');
  const end = renderer.indexOf('}  // namespace', start);
  assert.ok(start >= 0 && end > start);
  const fastPath = renderer.slice(start, end);

  assert.match(fastPath, /SourceMemoryDc\(destDc\)/);
  assert.match(fastPath, /SetStretchBltMode\(destDc, COLORONCOLOR\)/);
  assert.match(fastPath, /BitBlt\(/);
  assert.match(fastPath, /StretchBlt\(/);
  assert.doesNotMatch(fastPath, /CreateCompatibleDC|DeleteDC|HALFTONE/);
});

test('all renderer-panel radar call sites are routed through the low-peak path', () => {
  const alias = renderer.indexOf(
    '#define StretchRadarInto StretchRadarIntoLowPeak',
  );
  const windows = renderer.indexOf(
    '#include "renderer_panels/windows.inc"',
  );
  const media = renderer.indexOf(
    '#include "renderer_panels/media_section.inc"',
  );
  const undef = renderer.lastIndexOf('#undef StretchRadarInto');

  assert.ok(alias >= 0);
  assert.ok(windows > alias);
  assert.ok(media > windows);
  assert.ok(undef > media);
});