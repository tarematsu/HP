import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  matchRegionalMusicCanonicalTrack,
  regionalMusicTitleKeys,
  resolveRegionalMusicCanonicalTrack,
} from '../src/regional-music-track-canonical.js';

const candidates = [
  { id: 11, title: '17分間', artist: '乃木坂46' },
  { id: 12, title: '羽根の記憶', artist: '乃木坂46' },
  { id: 13, title: '承認欲求', artist: '櫻坂46' },
  { id: 14, title: 'Nightmare症候群', artist: '櫻坂46' },
];

test('Chinese catalog annotations preserve the original Japanese title identity', () => {
  assert.equal(matchRegionalMusicCanonicalTrack('17分間 (17分钟)', candidates)?.id, 11);
  assert.equal(matchRegionalMusicCanonicalTrack('羽根の記憶 (翅膀的记忆)', candidates)?.id, 12);
  assert.equal(matchRegionalMusicCanonicalTrack('Nightmare症候群', candidates)?.id, 14);
});

test('Japanese and simplified Chinese character variants fold to the same identity', () => {
  assert.deepEqual(regionalMusicTitleKeys('承認欲求'), ['承认欲求']);
  assert.deepEqual(regionalMusicTitleKeys('承认欲求'), ['承认欲求']);
  assert.equal(matchRegionalMusicCanonicalTrack('承认欲求', candidates)?.id, 13);
});

test('ambiguous titles and translation-only titles are never guessed', () => {
  assert.equal(matchRegionalMusicCanonicalTrack('同じ曲', [
    { id: 1, title: '同じ曲' },
    { id: 2, title: '同じ曲' },
  ]), null);
  assert.equal(matchRegionalMusicCanonicalTrack('翅膀的记忆', candidates), null);
});

test('QQ and Kugou resolver returns sh_tracks.id without allocating a parallel identity', async () => {
  const minuteDb = {
    prepare(sql) {
      assert.match(sql, /FROM sh_tracks/);
      return {
        bind(...bindings) {
          assert.ok(bindings.includes('櫻坂46'));
          return { all: async () => ({ results: candidates.filter((row) => row.artist === '櫻坂46') }) };
        },
      };
    },
  };
  const env = { MINUTE_DB: minuteDb };
  const resolved = await resolveRegionalMusicCanonicalTrack(env, {
    service: 'qq_music',
    service_track_id: 'qq-mid-1',
    canonical_artist: 'sakurazaka46',
    title: '承认欲求',
  });
  assert.equal(resolved.canonical_track_id, 13);

  const untouched = await resolveRegionalMusicCanonicalTrack(env, {
    service: 'netease_cloud_music',
    service_track_id: 'netease-1',
    canonical_artist: 'sakurazaka46',
    title: '承認欲求',
  });
  assert.equal(untouched.canonical_track_id, undefined);
});

test('regional collector binds MINUTE_DB and canonicalizes before every track store', () => {
  const config = readFileSync(new URL('../wrangler.regional-music.jsonc', import.meta.url), 'utf8');
  const store = readFileSync(new URL('../src/regional-music-store.js', import.meta.url), 'utf8');
  assert.match(config, /"binding": "MINUTE_DB"/);
  assert.match(config, /"database_name": "stationhead-minute"/);
  assert.match(store, /value = await resolveRegionalMusicCanonicalTrack\(env, value\)/);
  assert.match(store, /canonical_track_id=COALESCE\(excluded\.canonical_track_id,canonical_track_id\)/);
});
