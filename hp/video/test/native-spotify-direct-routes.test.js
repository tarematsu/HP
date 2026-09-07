import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routes = readFileSync(
  new URL('../../native/src/spotify_recent_direct_routes.inc', import.meta.url),
  'utf8',
);

test('all 35 recent catalog entries use direct Spotify track routes', () => {
  assert.doesNotMatch(routes, /nullptr/);
  assert.equal(
    (routes.match(/https:\/\/open\.spotify\.com\/track\//g) || []).length,
    35,
  );
  assert.equal((routes.match(/L"\/track\//g) || []).length, 35);

  for (const id of [
    '33liCluqUasE65nMv3KLLm',
    '5QnQ7m9OxSoFeSPSz8grqX',
    '2CMSkSwIfnNQR7bTNFFeB5',
    '2meBhRDzQpf0ltQH11HbWG',
  ]) {
    assert.equal((routes.match(new RegExp(id, 'g')) || []).length, 2);
  }
});
