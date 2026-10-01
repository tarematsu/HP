import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildZingApiUrl,
  parseZingSearchTracks,
} from '../src/regional-music-zing.js';

test('Zing signed URL contains configured client fields without exposing them elsewhere', async () => {
  const url = await buildZingApiUrl('/api/v2/search/multi', { q: 'Nogizaka46', allowCorrect: '1' }, {
    apiKey: 'test-key',
    secretKey: 'test-secret',
    version: '1.19.1',
    ctime: '1',
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://zingmp3.vn');
  assert.equal(parsed.pathname, '/api/v2/search/multi');
  assert.equal(parsed.searchParams.get('q'), 'Nogizaka46');
  assert.equal(parsed.searchParams.get('apiKey'), 'test-key');
  assert.match(parsed.searchParams.get('sig') || '', /^[0-9a-f]{128}$/);
});

test('Zing parser keeps only exact target-artist songs', () => {
  const payload = {
    data: {
      songs: [
        {
          encodeId: 'AAA',
          title: 'Target Song',
          duration: 200,
          link: '/bai-hat/target/AAA.html',
          artists: [{ name: 'Nogizaka46' }],
          album: { title: 'Target Album' },
        },
        {
          encodeId: 'BBB',
          title: 'Wrong Artist',
          duration: 180,
          link: '/bai-hat/wrong/BBB.html',
          artistsNames: 'Not Nogizaka',
        },
      ],
    },
  };
  assert.deepEqual(parseZingSearchTracks(payload, ['乃木坂46', 'Nogizaka46']), [{
    track_id: 'AAA',
    title: 'Target Song',
    album_name: 'Target Album',
    track_url: 'https://zingmp3.vn/bai-hat/target/AAA.html',
  }]);
});
