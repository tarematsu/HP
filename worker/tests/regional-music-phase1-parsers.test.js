import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findAnghamiArtistId,
  parseAnghamiArtistMetrics,
  parseAnghamiTrackMetrics,
} from '../src/regional-music-anghami.js';
import {
  absoluteNhacCuaTuiUrl,
  findNhacCuaTuiArtistHref,
  parseNhacCuaTuiMetrics,
} from '../src/regional-music-nhaccuatui.js';

test('Anghami parses compact artist and track metrics and requires exact artist identity', () => {
  assert.deepEqual(
    parseAnghamiArtistMetrics('<main><h1>Nogizaka46</h1><p>1.2K Followers</p><p>5.1M Plays</p></main>'),
    { followers: 1200, plays: 5100000 },
  );
  assert.deepEqual(
    parseAnghamiTrackMetrics('<main><p>20 Plays</p><p>3 Likes</p></main>'),
    { plays: 20, likes: 3 },
  );
  assert.equal(
    findAnghamiArtistId('<a href="https://play.anghami.com/artist/12345"><span>Sakurazaka46</span></a>', 'Sakurazaka46'),
    '12345',
  );
  assert.equal(
    findAnghamiArtistId('<a href="https://play.anghami.com/artist/999"><span>Sakurazaka46 Cover</span></a>', 'Sakurazaka46'),
    null,
  );
});

test('NhacCuaTui parses metrics, normalizes URLs, and rejects lookalike artists', () => {
  const html = '<main><h1>One Choice</h1><p>Hinatazaka46</p><b>6</b> Play <a href="/nghe-si/hinatazaka46.html">Hinatazaka46</a> <span>6 followers</span></main>';
  assert.deepEqual(parseNhacCuaTuiMetrics(html, 'Hinatazaka46'), { followers: 6, plays: 6 });
  assert.equal(findNhacCuaTuiArtistHref(html, 'Hinatazaka46'), '/nghe-si/hinatazaka46.html');
  assert.equal(
    absoluteNhacCuaTuiUrl('/nghe-si/hinatazaka46.html'),
    'https://www.nhaccuatui.com/nghe-si/hinatazaka46.html',
  );
  assert.equal(
    findNhacCuaTuiArtistHref('<a href="/nghe-si/fake.html">Hinatazaka46 Cover</a>', 'Hinatazaka46'),
    null,
  );
});
