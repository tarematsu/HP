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

test('ambiguous titles stay unresolved unless one duplicate has a uniquely stronger identity', () => {
  assert.equal(matchRegionalMusicCanonicalTrack('同じ曲', [
    { id: 1, title: '同じ曲' },
    { id: 2, title: '同じ曲' },
  ]), null);
  assert.equal(matchRegionalMusicCanonicalTrack('同じ曲', [
    { id: 1, title: '同じ曲' },
    { id: 2, title: '同じ曲', isrc: 'JPTEST000001', spotify_id: 'spotify-2' },
    { id: 3, title: '同じ曲' },
  ])?.id, 2);
  assert.equal(matchRegionalMusicCanonicalTrack('同じ曲', [
    { id: 1, title: '同じ曲', isrc: 'JPTEST000001' },
    { id: 2, title: '同じ曲', isrc: 'JPTEST000002' },
  ]), null);
  assert.equal(matchRegionalMusicCanonicalTrack('翅膀的记忆', candidates), null);
});

test('every retained regional music service resolves provider aliases to sh_tracks.id', async () => {
  const rows = [
    { id: 13, title: '承認欲求', artist: '櫻坂46', isrc: 'JPU900000013' },
    { id: 1070, title: 'Audition', artist: '坂道選抜, 乃木坂46, 櫻坂46, 日向坂46', isrc: 'JPU902603797' },
    { id: 1218, title: '制服のマネキン', artist: '노기자카46', isrc: 'JPSR01204101' },
    { id: 1300, title: '青葉のうた', artist: '青葉坂46', isrc: 'JPAOB2600001' },
  ];
  const minuteDb = {
    prepare(sql) {
      assert.match(sql, /FROM sh_tracks/);
      assert.match(sql, /LIKE/);
      return {
        bind(...bindings) {
          const selected = rows.filter(row => bindings.some(value => row.artist.includes(String(value).replaceAll('%',''))));
          return { all: async () => ({ results: selected }) };
        },
      };
    },
  };
  const env = { MINUTE_DB: minuteDb };
  const resolved = await resolveRegionalMusicCanonicalTrack(env, {
    service: 'qq_music', service_track_id: 'qq-mid-1', canonical_artist: 'sakurazaka46', title: '承认欲求',
  });
  assert.equal(resolved.canonical_track_id, 13);
  assert.equal(resolved.track_id, 13);

  const audition = await resolveRegionalMusicCanonicalTrack(env, {
    service: 'kugou_music', service_track_id: 'kg-audition', canonical_artist: 'nogizaka46', title: 'Audition',
  });
  assert.equal(audition.canonical_track_id, 1070);
  assert.equal(audition.track_id, 1070);

  const mannequin = await resolveRegionalMusicCanonicalTrack(env, {
    service: 'qq_music', service_track_id: 'qq-mannequin', canonical_artist: 'nogizaka46', title: '制服のマネキン',
  });
  assert.equal(mannequin.canonical_track_id, 1218);

  for (const service of ['kkbox','qq_music','kugou_music']) {
    const result = await resolveRegionalMusicCanonicalTrack(env, {
      service, service_track_id: `${service}-1`, canonical_artist: 'sakurazaka46', title: '承認欲求',
    });
    assert.equal(result.track_id, 13, service);
    assert.equal(result.canonical_track_id, 13, service);
  }

  const youtube = await resolveRegionalMusicCanonicalTrack(env, {
    service: 'youtube_music', service_track_id: 'youtube-1', canonical_artist: 'aobazaka46', title: '青葉のうた',
  });
  assert.equal(youtube.track_id, 1300);
  assert.equal(youtube.canonical_track_id, 1300);

  const preResolved = await resolveRegionalMusicCanonicalTrack({}, {
    service: 'kkbox', canonical_track_id: 99, service_track_id: 'kkbox-99',
  });
  assert.equal(preResolved.track_id, 99);
  assert.equal(preResolved.canonical_track_id, 99);
});

test('regional collector binds MINUTE_DB and canonicalizes before every track store', () => {
  const config = readFileSync(new URL('../wrangler.regional-music.jsonc', import.meta.url), 'utf8');
  const store = readFileSync(new URL('../src/regional-music-store.js', import.meta.url), 'utf8');
  assert.match(config, /"binding": "MINUTE_DB"/);
  assert.match(config, /"database_name": "stationhead-minute"/);
  assert.match(store, /value = await resolveRegionalMusicCanonicalTrack\(env, value\)/);
  assert.match(store, /canonical_track_id=COALESCE\(excluded\.canonical_track_id,canonical_track_id\)/);
  assert.match(store, /regional_music_track_daily\([\s\S]*track_id/);
  assert.match(store, /regional_music_playlist_memberships\([\s\S]*track_id/);
});
