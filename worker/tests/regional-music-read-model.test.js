import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadRegionalMusicReadModel,
  publishRegionalMusicReadModels,
  publishRegionalMusicServiceReadModel,
  qqAnimeChartReadModel,
  qqJapanChartReadModel,
  melonJpopChartReadModel,
  regionalMusicReadModelKey,
  regionalMusicReadModelPayload,
  regionalMusicServiceReadModelPayload,
} from '../src/regional-music-read-model.js';
import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';
import { QQ_JAPAN_HISTORY_VIEW_KEY } from '../src/qq-japan-chart-history-view.js';
import { QQ_ANIME_HISTORY_INDEX_KEY, QQ_ANIME_HISTORY_VIEW_KEY } from '../src/qq-anime-chart-history-view.js';
import { MELON_JPOP_HISTORY_VIEW_KEY } from '../src/melon-jpop-history.js';

test('regional music read model normalizes collector health and implemented service metadata', () => {
  const payload = regionalMusicReadModelPayload({
    artists: [{ service: 'joox', canonical_artist: 'sakurazaka46', followers: 478 }],
    tracks: [],
    releases: [],
    playlists: [],
    memberships: [],
    services: [{
      service: 'joox',
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
  assert.deepEqual(payload.melon_jpop_chart, { coverage:{}, periods:[], history:[] });
  assert.deepEqual(payload.services[0].entity_counts, { artists: 3 });
  assert.equal(payload.services[0].region, 'HK/TH/SEA');
  assert.equal(payload.services[0].phase, 1);
  assert.deepEqual(payload.services[0].metrics, ['artist_followers']);
  assert.deepEqual(payload.services[1].entity_counts, {});
  assert.equal(payload.services[1].region, null);
  assert.equal(payload.services[1].phase, null);
  assert.deepEqual(payload.services[1].metrics, []);
});

test('service read model contains only the selected service and owns its update timestamp', () => {
  const payload = regionalMusicServiceReadModelPayload({
    artists:[
      { service:'bugs', canonical_artist:'sakurazaka46', followers:10, observed_at:700 },
      { service:'joox', canonical_artist:'sakurazaka46', followers:20, observed_at:800 },
    ],
    tracks:[
      { service:'bugs', service_track_id:'b1', observed_at:710 },
      { service:'joox', service_track_id:'j1', observed_at:810 },
    ],
    releases:[], playlists:[], memberships:[], artistTrackOrders:[],
    services:[
      { service:'bugs', status:'ok', updated_at:720, entity_counts_json:'{}' },
      { service:'joox', status:'ok', updated_at:820, entity_counts_json:'{}' },
    ],
  }, 'bugs', 1000);
  assert.equal(payload.service,'bugs');
  assert.equal(payload.updated_at,1000);
  assert.equal(payload.source_updated_at,720);
  assert.deepEqual(payload.artists.map(row=>row.service),['bugs']);
  assert.deepEqual(payload.tracks.map(row=>row.service),['bugs']);
  assert.deepEqual(payload.services.map(row=>row.service),['bugs']);
  assert.equal('qq_japan_chart' in payload,false);
  assert.equal('qq_anime_chart' in payload,false);
  assert.equal('melon_jpop_chart' in payload,false);
  assert.equal('kkbox_japanese_chart' in payload,false);
  assert.equal('netease_japan_chart' in payload,false);
  assert.equal('kugou_japan_chart' in payload,false);
  assert.equal(regionalMusicReadModelKey('bugs'),'regional-music:bugs');
  assert.throws(()=>regionalMusicReadModelKey('missing'),/unknown regional music service/);
});

test('regional read model normalizes compact QQ Japan and anime chart views', () => {
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
});

test('regional read model includes complete Kugou Japan chart seed and coverage boundary', () => {
  const payload = regionalMusicReadModelPayload({}, 456);
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
  assert.ok(history.some((item) => item.published_at === '2019-04-22' && item.canonical_artist === 'hinatazaka46' && item.rank === 50));
  assert.ok(history.some((item) => item.published_at === '2019-05-30' && item.canonical_artist === 'nogizaka46' && item.rank === 45));
});

test('YouTube Music collector metadata exposes free public metrics without account-only fields', () => {
  const payload = regionalMusicServiceReadModelPayload({
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

  const snapshot = await loadRegionalMusicReadModel(db);
  assert.deepEqual(snapshot.memberships, []);
  assert.deepEqual(snapshot.releases, []);
  const membershipQuery = queries.find((sql) => sql.includes('regional_music_playlist_memberships AS m'));
  assert.ok(membershipQuery);
  assert.match(membershipQuery, /regional_music_playlist_snapshots AS s/);
  assert.match(membershipQuery, /MAX\(x\.snapshot_date\)/);
  assert.ok(queries.some((sql) => sql.includes('regional_music_releases')));
  assert.ok(queries.some((sql) => sql.includes('monthly_audience')));
});

test('regional music publication writes independent service-scoped R2 objects', async () => {
  const writes = [];
  const result = await publishRegionalMusicReadModels({
    OTHER_DB: {},
    PAGES_RESPONSE_R2: { put() {}, async get() { return null; } },
  }, ['bugs','qq_music'], 1000, {
    loadReadModel: async () => ({
      artists: [{ service: 'bugs', canonical_artist:'sakurazaka46', observed_at:800 }],
      tracks: [{ service: 'qq_music', service_track_id:'q1', observed_at:900 }],
      releases: [{ service: 'youtube_music' }],
      playlists: [{ service: 'melon' }],
      memberships: [{ service: 'melon' }],
      services: [
        { service: 'bugs', status: 'ok', entity_counts_json: '{}', updated_at:810 },
        { service: 'qq_music', status: 'ok', entity_counts_json: '{}', updated_at:910 },
      ],
    }),
    saveR2Response: async (_r2, key, body, status, headers, now, cadence) => {
      writes.push({ key, body: JSON.parse(body), status, headers, now, cadence });
      return { storage: 'r2', bytes: body.length };
    },
  });

  assert.equal(writes.length, 2);
  const bugs=writes.find(row=>row.key==='regional-music:bugs');
  const qq=writes.find(row=>row.key==='regional-music:qq_music');
  assert.ok(bugs);
  assert.ok(qq);
  assert.equal(bugs.status,200);
  assert.equal(bugs.now,1000);
  assert.equal(bugs.cadence,86400);
  assert.equal(bugs.body.service,'bugs');
  assert.equal(bugs.body.artists.length,1);
  assert.equal(bugs.body.tracks.length,0);
  assert.equal('qq_japan_chart' in bugs.body,false);
  assert.equal(qq.body.service,'qq_music');
  assert.equal(qq.body.artists.length,0);
  assert.equal(qq.body.tracks.length,1);
  assert.equal(Array.isArray(qq.body.qq_japan_chart.history),true);
  assert.equal(result.models,2);
  assert.equal(result.written,2);
  assert.equal(result.skipped,0);
});

test('unchanged service source keeps its previous read-model update time and performs no write', async () => {
  const existingPayload={
    ok:true,
    read_model_version:1,
    service:'bugs',
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
  const existingKey=pagesActionsR2ResponseKey('regional-music:bugs');
  const result=await publishRegionalMusicServiceReadModel({
    OTHER_DB:{},
    PAGES_RESPONSE_R2:{
      put(){throw new Error('must not write');},
      async get(key) {
        if(key===existingKey) return {async json(){return structuredClone(existingEnvelope);}};
        return null;
      },
    },
  },'bugs',1000,{
    loadReadModel:async()=>({
      artists:[],tracks:[],releases:[],playlists:[],memberships:[],artistTrackOrders:[],
      services:[{service:'bugs',status:'ok',updated_at:700,entity_counts_json:'{}'}],
    }),
    saveR2Response:async()=>{throw new Error('must not save');},
  });
  assert.equal(result.skipped,true);
  assert.equal(result.updated_at,800);
  assert.equal(result.source_updated_at,700);
});

test('QQ service publication injects QQ Japan history view from R2', async () => {
  const writes = [];
  const qqView = {
    updated_at:950,
    coverage:{ earliest_period:'2018_1', latest_period:'2026_40', latest_rank_in_period:'2026_40', stored_periods:455, entries:1 },
    history:[{ period:'2026_40', published_at:'2026-10-01', canonical_artist:'sakurazaka46', rank:9, title:'Sakura' }],
  };
  const result = await publishRegionalMusicServiceReadModel({
    OTHER_DB:{},
    PAGES_RESPONSE_R2:{
      put() {},
      async get(key) {
        if (key === QQ_JAPAN_HISTORY_VIEW_KEY) return { async json() { return structuredClone(qqView); } };
        return null;
      },
    },
  },'qq_music',1000, {
    loadReadModel:async () => ({ artists:[], tracks:[], releases:[], playlists:[], memberships:[], services:[] }),
    saveR2Response:async (_r2, key, body) => {
      writes.push({key,body:JSON.parse(body)});
      return { storage:'r2', bytes:body.length };
    },
  });
  assert.equal(writes.length,1);
  assert.equal(writes[0].key,'regional-music:qq_music');
  assert.equal(writes[0].body.qq_japan_chart.coverage.latest_period, '2026_40');
  assert.equal(writes[0].body.qq_japan_chart.history[0].rank, 9);
  assert.equal(writes[0].body.source_updated_at,950);
  assert.equal(result.model_key,'regional-music:qq_music');
});


test('Melon J-pop chart read model preserves periods and history', () => {
  const normalized = melonJpopChartReadModel({
    coverage:{ earliest_period:'2026-09-28', latest_period:'2026-09-28' },
    periods:[{ period:'2026-09-28', published_at:'2026-09-28' }],
    history:[{ period:'2026-09-28', canonical_artist:'sakurazaka46', rank:12, title:'S' }],
  });
  assert.equal(normalized.periods.length,1);
  assert.equal(normalized.history[0].rank,12);
});

test('QQ service publication injects both Japan and anime chart views', async () => {
  const writes=[];
  const japan={updated_at:940,coverage:{latest_period:'2026_40'},history:[{period:'2026_40',rank:9,title:'J'}]};
  const anime={updated_at:950,coverage:{latest_period:'2026_40'},history:[{period:'2026_40',rank:7,title:'A'}]};
  await publishRegionalMusicServiceReadModel({
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

test('Melon service publication owns Melon J-pop chart and its source timestamp', async () => {
  const writes=[];
  const view={updated_at:960,coverage:{latest_period:'2026-09-28'},periods:[{period:'2026-09-28'}],history:[{period:'2026-09-28',rank:4,title:'M'}]};
  await publishRegionalMusicServiceReadModel({
    OTHER_DB:{},
    PAGES_RESPONSE_R2:{put(){},async get(key){return key===MELON_JPOP_HISTORY_VIEW_KEY?{async json(){return structuredClone(view);}}:null;}},
  },'melon',1000,{
    loadReadModel:async()=>({artists:[],tracks:[],releases:[],playlists:[],memberships:[],services:[]}),
    saveR2Response:async(_r2,key,body)=>{writes.push({key,body:JSON.parse(body)});return {storage:'r2',bytes:body.length};},
  });
  assert.equal(writes[0].key,'regional-music:melon');
  assert.equal(writes[0].body.melon_jpop_chart.history[0].rank,4);
  assert.equal(writes[0].body.source_updated_at,960);
  assert.equal('qq_japan_chart' in writes[0].body,false);
});
