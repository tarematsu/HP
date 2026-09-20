import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const locator = readFileSync(
  new URL('../../native/src/sh_start_button_locator_policy.h', import.meta.url),
  'utf8',
);

test('Stationhead can bring an offscreen Start Listening control into the compact viewport before CDP click', () => {
  const renderedStart = locator.indexOf('const visuallyRendered = element =>');
  const pointStart = locator.indexOf('const pointOf = element =>', renderedStart);
  const playingStart = locator.indexOf('const playing = () =>', pointStart);

  assert.ok(renderedStart >= 0 && pointStart > renderedStart);
  assert.ok(playingStart > pointStart);

  const rendered = locator.slice(renderedStart, pointStart);
  const pointOf = locator.slice(pointStart, playingStart);

  assert.doesNotMatch(
    rendered,
    /rect\.right\s*<=\s*0|rect\.bottom\s*<=\s*0|rect\.left\s*>=\s*innerWidth|rect\.top\s*>=\s*innerHeight/,
  );
  assert.match(pointOf, /element\.scrollIntoView\(/);
  assert.match(pointOf, /rect = element\.getBoundingClientRect\(\)/);
  assert.match(pointOf, /document\.elementFromPoint\(x, y\)/);
  assert.ok(
    pointOf.indexOf('scrollIntoView') < pointOf.indexOf('document.elementFromPoint'),
    'the locator must scroll before performing the final hit test',
  );
});

test('Stationhead keeps auth blocking viewport-scoped while Start Listening discovery is render-scoped', () => {
  assert.match(
    locator,
    /for \(const element of document\.querySelectorAll\(credentialSelector\)\) \{[\s\S]*?visuallyRendered\(element\)[\s\S]*?intersectsViewport\(element\.getBoundingClientRect\(\)\)/,
  );
  assert.match(
    locator,
    /for \(const element of document\.querySelectorAll\(candidateSelector\)\) \{\s*if \(!visuallyRendered\(element\) \|\| !matchesLabel\(element, startPattern\)\) continue;/,
  );
});
