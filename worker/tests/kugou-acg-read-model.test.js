import assert from 'node:assert/strict';
import test from 'node:test';

import { publishRegionalMusicServiceReadModel } from '../src/regional-music-read-model.js';
import {
  KUGOU_ACG_HISTORY_INDEX_KEY,
  KUGOU_ACG_HISTORY_VIEW_KEY,
} from '../src/kugou-acg-chart-history.js';

test('Kugou publication injects ACG chart history from R2', async () => {
  const writes = [];
  const view = {
    updated_at:950,
    coverage:{ earliest_period:'2025_9', latest_period:'2026_40', stored_periods:83, entries:1 },
    history:[{
      period:'2025_10',
      published_at:'2025-03-06',
      canonical_artist:'sakurazaka46',
      rank:35,
      title:'ピッカーン！',
    }],
  };
  const index = {
    updated_at:945,
    weeks:{
      '2025_10':{ period:'2025_10', published_at:'2025-03-06', volid:'1000', entries:1 },
    },
  };

  const result = await publishRegionalMusicServiceReadModel({
    OTHER_DB:{},
    PAGES_RESPONSE_R2:{
      put() {},
      async get(key) {
        if (key === KUGOU_ACG_HISTORY_VIEW_KEY) return { async json() { return structuredClone(view); } };
        if (key === KUGOU_ACG_HISTORY_INDEX_KEY) return { async json() { return structuredClone(index); } };
        return null;
      },
    },
  }, 'kugou_music', 1000, {
    loadReadModel:async () => ({
      artists:[], tracks:[], releases:[], playlists:[], memberships:[], artistTrackOrders:[], services:[],
    }),
    saveR2Response:async (_r2,key,body) => {
      writes.push({ key, body:JSON.parse(body) });
      return { storage:'r2', bytes:body.length };
    },
  });

  assert.equal(writes.length,1);
  assert.equal(writes[0].key,'music-service:kugou_music');
  assert.equal(writes[0].body.kugou_acg_chart.coverage.latest_period,'2026_40');
  assert.equal(writes[0].body.kugou_acg_chart.periods[0].published_at,'2025-03-06');
  assert.equal(writes[0].body.kugou_acg_chart.history[0].rank,35);
  assert.equal(writes[0].body.source_updated_at,950);
  assert.equal(result.model_key,'music-service:kugou_music');
});