import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../src/spotify-playcount-consumer.js', import.meta.url),
  'utf8',
);

test('Spotify finalization is claimed before candidate and previous-day heavy reads', () => {
  const start = source.indexOf('async function finalizeAttempt');
  const end = source.indexOf('\nexport async function updateAlbumProgress', start);
  const finalize = source.slice(start, end);

  const claim = finalize.indexOf("SET status='finalizing'");
  const candidates = finalize.indexOf('FROM sh_spotify_playcount_candidates');
  const previous = finalize.indexOf('FROM sh_spotify_playcount_daily_canonical');

  assert.ok(claim >= 0, 'finalization claim must exist');
  assert.ok(candidates > claim, 'candidate read must happen after claim');
  assert.ok(previous > claim, 'previous-day read must happen after claim');
  assert.match(finalize, /status IN \('catalog','queued'\)[\s\S]*albums_completed>=albums_queued/);
  assert.match(finalize, /if \(Number\(claim\?\.meta\?\.changes \|\| 0\) !== 1\) return \{ finalizing: true \};/);
});
