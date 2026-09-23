import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const theme = readFileSync(new URL('../public/monochrome.css', import.meta.url), 'utf8');

test('dashboard tabs use one row on tablet and desktop', () => {
  assert.match(
    theme,
    /\.mode-tabs\.dashboard-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(9, minmax\(0, 1fr\)\)/s,
  );
});

test('dashboard tabs use five columns on mobile, including narrow phones', () => {
  assert.match(
    theme,
    /@media \(max-width: 760px\)[\s\S]*?\.mode-tabs\.dashboard-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    theme,
    /@media \(max-width: 430px\)[\s\S]*?\.mode-tabs\.dashboard-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/,
  );
});
