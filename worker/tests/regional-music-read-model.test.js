import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadMusicServicesReadModel,
  publishMusicServiceReadModels,
  publishMusicServiceReadModel,
  qqAnimeChartReadModel,
  qqJapanChartReadModel,
  chartHistoryReadModel,
  musicServiceReadModelKey,
  musicServicesReadModelPayload,
  musicServiceReadModelPayload,
} from '../src/music-service-read-model.js';
import { pagesR2ResponseKey } from '../src/pages-response-r2.js';
import { QQ_JAPAN_HISTORY_VIEW_KEY } from '../src/qq-japan-chart-history-view.js';
import { QQ_ANIME_HISTORY_INDEX_KEY, QQ_ANIME_HISTORY_VIEW_KEY } from '../src/qq-anime-chart-history-view.js';
import { KKBOX_JAPANESE_HISTORY_VIEW_KEY } from '../src/kkbox-japanese-chart-history.js';

test('music service read model normalizes collector health for retained services', () => {
  const payload = musicServicesReadModelPayload({
    artists: [{ service: 'kkbox', canonical_artist: 'sakurazaka46', followers: 478 }],
    tracks: [],
    releases: [],
    playlists: [],
    memberships: [],
    services: [{
      service: 'kkbox',
      status: 'ok',
      entity_counts_json: '{"artists":3}',
      updated_at: 123,
    }, {
      service: 'broken',
      status: 'degraded',
      entity_counts_json: 'not-json',
    }],
  }, 456);

  assert.equal(payload.ok, true);
  assert.equal(payload.updated_at, 456);
  assert.equal(payload.artists[0].followers, 478);
  assert.deepEqual(payload.releases, []);
  assert.deepEqual(payload.qq_japan_chart, { coverage:{}, history:[] });
  assert.deepEqual(payload.qq_anime_chart, { coverage:{}, history:[] });
  assert.deepEqual(payload.kkbox_japanese_chart, { coverage:{}, periods:[], history:[] });
  assert.deepEqual(payload.services[0].entity_counts, { artists: 3 });
  assert.equal(payload.services[0].region, 'TW/HK');
  assert.equal(payload.services[0].phase, 2);
  assert.deepEqual(payload.services[0].metrics, ['catalog','rankings']);
  assert.deepEqual(payload.services[1].entity_counts, {});
  assert.equal(payload.services[1].region, null);
  assert.equal(payload.services[1].phase, null);
  assert.deepEqual(payload.services[1].metrics, []);
});

test('service read model contains only the selected service and owns its update timestamp', () => {
  const payload = musicServiceReadModelPayload({
    artists:[
      { service:'youtube_music', canonical_artist:'sakurazaka46', followers:10, observed_at:700 },
      { service:'qq_music', canonical_artist:'sakurazaka46', followers:20, observed_at:800 },
    ],
    tracks:[
      { service:'youtube_music', service_track_id:'y1', observed_at:710 },
      { service:'qq_music', service_track_id:'q1', observed_at:810 },
    ],
    releases:[], playlists:[], memberships:[], artistTrackOrders:[],
    services:[
      { service:'youtube_music', status:'ok', updated_at:720, entity_counts_json:'{}' },
      { service:'qq_music', status:'ok', updated_at:820, entity_counts_json:'{}' },
    ],
  }, 'youtube_music', 1000);
  assert.equal(payload.service,'youtube_music');
  assert.equal(payload.updated_at,1000);
  assert.equal(payload.source_updated_at,720);
  assert.deepEqual(payload.artists.map(row=>row.service),['youtube_music']);
  assert.deepEqual(payload.tracks.map(row=>row.service),['youtube_music']);
  assert.deepEqual(payload.services.map(row=>row.service),['youtube_music']);
  assert.equal('qq_japan_chart' in payload,false);
  assert.equal('qq_anime_chart' in payload,false);
  assert.equal('kkbox_japanese_chart' in payload,false);
  assert.equal('kugou_japan_chart' in payload,false);
  assert.equal(musicServiceReadModelKey('youtube_music'),'music-service:youtube_music');
  assert.throws(()=>musicServiceReadModelKey('missing'),/unknown music service/);
});

test('music chart view normalizers preserve compact history payloads', () => {
  const normalized = qqJapanChartReadModel({
    coverage:{ earliest_period:'2018_1', latest_period:'2026_40', entries:2 },
    history:[
      { period:'2026_40', canonical_artist:'sakurazaka46', rank:9, title:'S' },
      { period:'2026_39', canonical_artist:'nogizaka46', rank:44, title:'N' },
    ],
  });
  assert.equal(normalized.coverage.latest_period, '2026_40');
  assert.equal(normalized.history.length, 2);
  assert.deepEqual(qqAnimeChartReadModel({ coverage:normalized.coverage, history:normalized.history }), normalized);
  assert.deepEqual(chartHistoryReadModel({
    coverage:{latest_period:'2026-40'},
    periods:[{period:'2026-40'}],
    history:[{period:'2026-40',rank:3}],
  }), {
    coverage:{latest_period:'2026-40'},
    periods:[{period:'2026-40'}],
    history:[{period:'2026-40',rank:3}],
  });
});

test('music service read model includes complete Kugou Japan chart seed and coverage boundary', () => {
  const payload = musicServicesReadModelPayload({}, 456);
  const history = payload.kugou_japan_chart.history;
  const counts = history.reduce((map, item) => map.set(item.canonical_artist, (map.get(item.canonical_artist) || 0) + 1), new Map());
  const best = (artist) => Math.min(...history.filter((item) => item.canonical_artist === artist).map((item) => item.rank));

  assert.equal(history.length, 1496);
  assert.equal(payload.kugou_japan_chart.coverage.oldest_available, '2017-11-22');
  assert.equal(payload.kugou_japan_chart.coverage.legacy_covered_dates.length, 1809);
  assert.equal(payload.kugou_japan_chart.coverage.current_api_oldest_available, '2024-10-31 10:10:01');
  assert.equal(payload.kugou_japan_chart.coverage.latest_available, '2026-09-30 10:10:01');
  assert.equal(counts.get('sakurazaka46'), 113);
  assert.equal(counts.get('nogizaka46'), 1127);
  assert.equal(counts.get('hinatazaka46'), 256);
  assert.equal(best('sakurazaka46'), 15);
  assert.equal(best('nogizaka46'), 1);
  assert.equal(best('hinatazaka46'), 4);
});

test('YouTube Music collector metadata exposes free public metrics without account-only fields', () => {
  const payload = musicServiceReadModelPayload({
    artists: [{
      service: 'youtube_music',
      canonical_artist: 'sakurazaka46',
      followers: 100,
      monthly_audience: 200,
      total_views: 300,
      observed_at:400,
    }],
    tracks: [],
    releases: [{ service: 'youtube_music', service_release_id: 'MPRE-test', last_seen_at:450 }],
    playlists: [],
    memberships: [],
    services: [{ service: 'youtube_music', status: 'ok', entity_counts_json: '{}', updated_at:456 }],
  }, 'youtube_music', 500);

  assert.equal(payload.artists[0].monthly_audience, 200);
  assert.equal(payload.artists[0].total_views, 300);
  assert.equal(payload.releases.length, 1);
  assert.equal(payload.source_updated_at,456);
  assert.deepEqual(payload.services[0].metrics, [
    'artist_followers',
    'monthly_audience',
    'total_views',
    'catalog',
    'releases',
    'playlists',
  ]);
});

test('playlist membership query follows the latest playlist snapshot, including an empty snapshot', async () => {
  const queries = [];
  const db = {
    prepare(sql) {
      queries.push(sql);
      return { async all() { return { results: [] }; } };
    },
  };

  const snapshot = await loadMusicServicesReadModel(db);
  assert.deepEqual(snapshot.memberships, []);
  assert.deepEqual(snapshot.releases, []);
  const membershipQuery = queries.find((sql) => sql.includes('regional_music_playlist_memberships AS m'));
  assert.ok(membershipQuery);
  assert.match(membershipQuery, /regional_music_playlist_snapshots AS s/);
  assert.match(membershipQuery, /MAX\(x\.snapshot_date\)/);
  assert.ok(queries.some((sql) => sql.includes('regional_music_releases')));
  assert.ok(queries.some((sql) => sql.includes('monthly_audience')));
});

test('music service publication writes independent service-scoped R2 objects', async () => {
  const writes = [];
  const result = await publishMusicServiceReadModels({
    OTHER_DB: {},
    PAGES_RESPONSE_R2: { put() {}, async get() { return null; } },
  }, ['kkbox','qq_music'], 1000, {
    loadReadModel: async () => ({
      artists: [{ service: 'kkbox', canonical_artist:'sakurazaka46', observed_at:800 }],
      tracks: [{ service: 'qq_music', service_track_id:'q1', observed_at:900 }],
      releases: [], playlists: [], memberships: [],
      services: [
        { service: 'kkbox', status: 'ok', entity_counts_json: '{}', updated_at:810 },
        { service: 'qq_music', status: 'ok', entity_counts_json: '{}', updated_at:910 },
      ],
    }),
    saveR2Response: async (_r2, key, body, status, headers, now, cadence) => {
      writes.push({ key, body: JSON.parse(body), status, headers, now, cadence });
      return { storage: 'r2', bytes: body.length };
    },
  });

  assert.equal(writes.length, 2);
  const kkbox=writes.find(row=>row.key==='music-service:kkbox');
  const qq=writes.find(row=>row.key==='music-service:qq_music');
  assert.ok(kkbox);
  assert.ok(qq);
  assert.equal(kkbox.status,200);
  assert.equal(kkbox.now,1000);
  assert.equal(kkbox.cadence,86400);
  assert.equal(kkbox.body.service,'kkbox');
  assert.equal(kkbox.body.artists.length,1);
  assert.equal(kkbox.body.tracks.length,0);
  assert.equal(Array.isArray(kkbox.body.kkbox_japanese_chart.history),true);
  assert.equal(qq.body.service,'qq_music');
  assert.equal(qq.body.artists.length,0);
  assert.equal(qq.body.tracks.length,1);
  assert.equal(Array.isArray(qq.body.qq_japan_chart.history),true);
  assert.equal(result.models,2);
  assert.equal(result.written,2);
  assert.equal(result.skipped,0);
});

test('unchanged legacy service source keeps its previous read-model update time and performs no write', async () => {
  const existingPayload={
    ok:true,
    read_model_version:1,
    service:'kkbox',
    updated_at:800,
    source_updated_at:700,
    artists:[],tracks:[],releases:[],playlists:[],playlist_memberships:[],artist_track_orders:[],services:[],
  };
  const existingEnvelope={
    version:1,
    status:200,
    headers:{'content-type':'application/json'},
    body:JSON.stringify(existingPayload),
    updated_at:800,
  };
  const existingKey=pagesR2ResponseKey('regional-music:kkbox');
  const result=await publishMusicServiceReadModel({
    OTHER_DB:{},
    PAGES_RESPONSE_R2:{
      put(){throw new Error('must not write');},
      async get(key) {
        if(key===existingKey) return {async json(){return structuredClone(existingEnvelope);}};
        return null;
      },
    },
  },'kkbox',1000,{
    loadReadModel:async()=>({
      artists:[],tracks:[],releases:[],playlists:[],memberships:[],artistTrackOrders:[],
      services:[{service:'kkbox',status:'ok',updated_at:700,entity_counts_json:'{}'}],
    }),
    saveR2Response:async()=>{throw new Error('must not save');},
  });
  assert.equal(result.model_key,'music-service:kkbox');
  assert.equal(result.skipped,true);
  assert.equal(result.updated_at,800);
  assert.equal(result.source_updated_at,700);
});

test('QQ service publication injects both Japan and anime chart views from R2', async () => {
  const writes=[];
  const japan={updated_at:940,coverage:{latest_period:'2026_40'},history:[{period:'2026_40',rank:9,title:'J'}]};
  const anime={updated_at:950,coverage:{latest_period:'2026_40'},history:[{period:'2026_40',rank:7,title:'A'}]};
  await publishMusicServiceReadModel({
    OTHER_DB:{},
    PAGES_RESPONSE_R2:{put(){},async get(key){
      if(key===QQ_JAPAN_HISTORY_VIEW_KEY) return {async json(){return structuredClone(japan);}};
      if(key===QQ_ANIME_HISTORY_VIEW_KEY) return {async json(){return structuredClone(anime);}};
      if(key===QQ_ANIME_HISTORY_INDEX_KEY) return {async json(){return {updated_at:945,weeks:{}};}};
      return null;
    }},
  },'qq_music',1000,{
    loadReadModel:async()=>({artists:[],tracks:[],releases:[],playlists:[],memberships:[],services:[]}),
    saveR2Response:async(_r2,key,body)=>{writes.push({key,body:JSON.parse(body)});return {storage:'r2',bytes:body.length};},
  });
  assert.equal(writes[0].body.qq_japan_chart.history[0].rank,9);
  assert.equal(writes[0].body.qq_anime_chart.history[0].rank,7);
  assert.equal(writes[0].body.source_updated_at,950);
});

test('KKBOX service publication owns Japanese chart history and source timestamp', async () => {
  const writes=[];
  const view={updated_at:960,coverage:{latest_period:'2026-40'},periods:[{period:'2026-40'}],history:[{period:'2026-40',rank:4,title:'K'}]};
  await publishMusicServiceReadModel({
    OTHER_DB:{},
    PAGES_RESPONSE_R2:{put(){},async get(key){return key===KKBOX_JAPANESE_HISTORY_VIEW_KEY?{async json(){return structuredClone(view);}}:null;}},
  },'kkbox',1000,{
    loadReadModel:async()=>({artists:[],tracks:[],releases:[],playlists:[],memberships:[],services:[]}),
    saveR2Response:async(_r2,key,body)=>{writes.push({key,body:JSON.parse(body)});return {storage:'r2',bytes:body.length};},
  });
  assert.equal(writes[0].key,'music-service:kkbox');
  assert.equal(writes[0].body.kkbox_japanese_chart.history[0].rank,4);
  assert.equal(writes[0].body.source_updated_at,960);
  assert.equal('qq_japan_chart' in writes[0].body,false);
});