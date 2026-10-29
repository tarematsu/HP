import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/repair-spotify-delta-history.yml', import.meta.url),
  'utf8',
);

test('documented Spotify spike investigation can trigger the guarded one-off repair', () => {
  assert.match(workflow, /docs\/spotify-daily-delta-spike-investigation\.md/);
  assert.match(workflow, /contains\(github\.event\.head_commit\.message, '\[repair-spotify-history\]'\)/);
  assert.match(workflow, /node scripts\/repair-spotify-delta-history-actions\.mjs/);
  assert.match(workflow, /if: steps\.repair\.outputs\.repaired == 'true'/);
  assert.match(workflow, /node scripts\/bootstrap-spotify-read-model\.mjs/);
});
