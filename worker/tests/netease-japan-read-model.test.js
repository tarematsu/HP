import test from 'node:test';
import assert from 'node:assert/strict';
import {
  neteaseJapanChartReadModel,
  publishRegionalMusicReadModel,
  regionalMusicReadModelPayload,
} from '../src/regional-music-read-model.js';
import { NETEASE_JAPAN_HISTORY_VIEW_KEY } from '../src/netease-japan-chart-history.js';

test('regional read model normalizes 网易云日语榜 history', () => {
  const view = neteaseJapanChartReadModel({
    coverage:{ earliest_period:'2026-09-29', latest_period:'2026-09-29', stored_periods:1 },
    periods:[{ period:'2026-09-29', published_at:'2026-09-29' }],
    history:[{ period:'2026-09-29', canonical_artist:'sakurazaka46', rank:12, title:'Example' }],
  });
  assert.equal(view.coverage.stored_periods,1);
  assert.equal(view.periods.length,1);
  assert.equal(view.history[0].rank,12);
  assert.deepEqual(regionalMusicReadModelPayload({},1).netease_japan_chart,{coverage:{},periods:[],history:[]});
});

test('regional music publication injects 网易云日语榜 history from R2', async () => {
  const published=[];
  const neteaseView={
    coverage:{ earliest_period:'2026-09-29', latest_period:'2026-09-29', stored_periods:1, entries:1 },
    periods:[{ period:'2026-09-29', published_at:'2026-09-29' }],
    history:[{ period:'2026-09-29', published_at:'2026-09-29', canonical_artist:'nogizaka46', rank:8, title:'Example' }],
  };
  const result=await publishRegionalMusicReadModel({
    OTHER_DB:{},
    PAGES_RESPONSE_R2:{
      put() {},
      async get(key) {
        if(key===NETEASE_JAPAN_HISTORY_VIEW_KEY) return {async json(){return structuredClone(neteaseView);}};
        return null;
      },
    },
  },1000,{
    loadReadModel:async()=>({artists:[],tracks:[],releases:[],playlists:[],memberships:[],services:[]}),
    saveR2Response:async(_r2,_key,body)=>{published.push(JSON.parse(body));return {storage:'r2',bytes:body.length};},
  });
  assert.equal(published[0].netease_japan_chart.history[0].rank,8);
  assert.equal(result.netease_japan_chart_entries,1);
});
