import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUGS_ARTISTS,
  bugsArtistUrl,
  parseBugsArtistLikes,
} from '../src/regional-music-bugs.js';

test('Bugs has stable artist targets for all three groups', () => {
  assert.deepEqual(BUGS_ARTISTS, {
    sakurazaka46: '80348696',
    hinatazaka46: '80329579',
    nogizaka46: '80192968',
  });
  assert.equal(
    bugsArtistUrl(BUGS_ARTISTS.nogizaka46),
    'https://music.bugs.co.kr/artist/80192968',
  );
});

test('Bugs artist like count is parsed across tag boundaries', () => {
  assert.equal(parseBugsArtistLikes('<button>좋아 <em>570</em></button>'), 570);
  assert.equal(parseBugsArtistLikes('<span>좋아&nbsp;<strong>2,338</strong></span>'), 2338);
  assert.equal(parseBugsArtistLikes('<div>other text</div>'), null);
});
