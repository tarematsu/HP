import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Sakurazaka comparison reuses shared formatters and canonical cache keys', () => {
  const source = readFileSync(
    new URL('../site/public/history/history-broadcasts.js', import.meta.url),
    'utf8',
  );
  const time = readFileSync(
    new URL('../site/public/dashboard-time.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /decimalOneFormat as number/);
  assert.doesNotMatch(source, /const number = new Intl\.NumberFormat/);
  assert.match(source, /JST_DATE_EN_CA/);
  assert.match(time, /new Intl\.DateTimeFormat\('en-CA'/);
  assert.match(time, /timeZone: 'Asia\/Tokyo'/);
  assert.match(source, /JST_DATE_EN_CA\.format\(new Date\(startedAt\)\)\.replaceAll\('-', ''\)/);
  assert.match(source, /return date \? `\$\{date\} \$\{name\}` : name/);
  assert.match(source, /sakurazaka46jp:v1:/);
  assert.match(source, /\/api\/sakurazaka46jp\?/);
  assert.doesNotMatch(source, /broadcast-series/);
  assert.doesNotMatch(source, /toLocaleString\(/);
  assert.doesNotMatch(source, /toLocaleDateString\(/);
});
