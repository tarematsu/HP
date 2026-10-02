import test from 'node:test';
import assert from 'node:assert/strict';
import {
  melonJpopChartReadModel,
  publishRegionalMusicReadModel,
  regionalMusicReadModelPayload,
} from '../src/regional-music-read-model.js';
import { MELON_JPOP_HISTORY_VIEW_KEY } from '../src/melon-jpop-history.js';

test('regional read model normalizes Melon J-pop history', () => {
  const view = melonJpopChartReadModel({
    coverage:{ checked_periods:854, failed_periods:92, entries:4 },
    periods:[{ period_type:'week', period:'2017-01-30_2017-02-05', status:'ok', entries:1 }],
    history:[{ period_type:'week', period:'2017-01-30_2017-02-05', canonical_artist:'keyakizaka46', rank:62, title:'Futari Saison' }],
  });
  assert.equal(view.coverage.checked_periods,854);
  assert.equal(view.periods.length,1);
  assert.equal(view.history[0].rank,62);
  assert.deepEqual(regionalMusicReadModelPayload({},1).melon_jpop_chart,{coverage:{},periods:[],history:[]});
});

test('regional music publication injects Melon J-pop history from R2', async () => {
  const published=[];
  const melonView={
    coverage:{ checked_periods:854, failed_periods:92, entries:4 },
    periods:[{ period_type:'month', period:'2017-02', status:'ok', entries:1 }],
    history:[{ period_type:'month', period:'2017-02', canonical_artist:'keyakizaka46', rank:92, title:'Futari Saison' }],
  };
  const result=await publishRegionalMusicReadModel({
    OTHER_DB:{},
    PAGES_RESPONSE_R2:{
      put() {},
      async get(key) {
        if(key===MELON_JPOP_HISTORY_VIEW_KEY) return {async json(){return structuredClone(melonView);}};
        return null;
      },
    },
  },1000,{
    loadReadModel:async()=>({artists:[],tracks:[],releases:[],playlists:[],memberships:[],services:[]}),
    saveR2Response:async(_r2,_key,body)=>{published.push(JSON.parse(body));return {storage:'r2',bytes:body.length};},
  });
  assert.equal(published[0].melon_jpop_chart.history[0].rank,92);
  assert.equal(result.melon_jpop_chart_entries,1);
});
