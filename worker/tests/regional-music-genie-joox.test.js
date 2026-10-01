import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractGenieTrackIds,
  findGenieArtistId,
  parseGenieArtistLikes,
  parseGenieTrackMetrics,
} from '../src/regional-music-genie.js';
import { parseJooxFollowers } from '../src/regional-music-joox.js';

test('Genie discovers exact artist and track ids', () => {
  const html = '<a href="/detail/artistInfo?xxnm=999">Nogizaka46 Cover</a>'
    + '<a href="/detail/artistInfo?xxnm=123">Nogizaka46</a>'
    + '<a href="/detail/songInfo?xgnm=111">A</a>'
    + '<a href="/detail/songInfo?xgnm=111">A again</a>'
    + '<a href="/detail/songInfo?xgnm=222">B</a>';
  assert.equal(findGenieArtistId(html, ['乃木坂46', 'Nogizaka46']), '123');
  assert.equal(findGenieArtistId('<a href="/detail/artistInfo?xxnm=999">Nogizaka46 Cover</a>', ['乃木坂46', 'Nogizaka46']), null);
  assert.deepEqual(extractGenieTrackIds(html), ['111', '222']);
});

test('Genie parses likes, cumulative listeners, and cumulative plays', () => {
  const html = '<main><span>좋아요!283</span><b>7,163</b> 전체 청취자수 <b>180,205</b> 전체 재생수</main>';
  assert.equal(parseGenieArtistLikes(html), 283);
  assert.deepEqual(parseGenieTrackMetrics(html), { likes: 283, listeners: 7163, plays: 180205 });
});

test('JOOX parses localized follower counts', () => {
  assert.equal(parseJooxFollowers('<main>478 粉絲</main>'), 478);
  assert.equal(parseJooxFollowers('<main>2.3k 粉絲</main>'), 2300);
  assert.equal(parseJooxFollowers('<main>9.3K followers</main>'), 9300);
  assert.equal(parseJooxFollowers('<main>10.2k ผู้ติดตาม</main>'), 10200);
});
