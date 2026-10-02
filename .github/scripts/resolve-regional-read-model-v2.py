from pathlib import Path

src = Path('worker/src/regional-music-read-model.js')
s = src.read_text()

s = s.replace(
    "import { NETEASE_JAPAN_HISTORY_VIEW_KEY } from './netease-japan-chart-history.js';\n",
    "import {\n"
    "  QQ_ANIME_HISTORY_INDEX_KEY,\n"
    "  QQ_ANIME_HISTORY_VIEW_KEY,\n"
    "} from './qq-anime-chart-history-view.js';\n"
    "import { NETEASE_JAPAN_HISTORY_VIEW_KEY } from './netease-japan-chart-history.js';\n"
    "import { MELON_JPOP_HISTORY_VIEW_KEY } from './melon-jpop-history.js';\n",
)

needle = "export function neteaseJapanChartReadModel(view) {"
if 'export function qqAnimeChartReadModel' not in s:
    s = s.replace(
        needle,
        "export function qqAnimeChartReadModel(view, index = null) {\n"
        "  return qqJapanChartReadModel(view, index);\n"
        "}\n\n" + needle,
    )

needle = 'function serviceRows(value, service) {'
if 'export function melonJpopChartReadModel' not in s:
    s = s.replace(
        needle,
        "export function melonJpopChartReadModel(view) {\n"
        "  return {\n"
        "    coverage:view?.coverage && typeof view.coverage === 'object' ? view.coverage : {},\n"
        "    periods:Array.isArray(view?.periods) ? view.periods : [],\n"
        "    history:Array.isArray(view?.history) ? view.history : [],\n"
        "  };\n"
        "}\n\n" + needle,
    )

s = s.replace(
    "  if (serviceId === 'qq_music') payload.qq_japan_chart = qqJapanChartReadModel(snapshot?.qqJapanChart, snapshot?.qqJapanChartIndex);",
    "  if (serviceId === 'qq_music') {\n"
    "    payload.qq_japan_chart = qqJapanChartReadModel(snapshot?.qqJapanChart, snapshot?.qqJapanChartIndex);\n"
    "    payload.qq_anime_chart = qqAnimeChartReadModel(snapshot?.qqAnimeChart, snapshot?.qqAnimeChartIndex);\n"
    "  }",
)
s = s.replace(
    "  if (serviceId === 'netease_cloud_music') payload.netease_japan_chart = neteaseJapanChartReadModel(snapshot?.neteaseJapanChart);",
    "  if (serviceId === 'netease_cloud_music') payload.netease_japan_chart = neteaseJapanChartReadModel(snapshot?.neteaseJapanChart);\n"
    "  if (serviceId === 'melon') payload.melon_jpop_chart = melonJpopChartReadModel(snapshot?.melonJpopChart);",
)

s = s.replace(
    "    qq_japan_chart: qqJapanChartReadModel(snapshot?.qqJapanChart, snapshot?.qqJapanChartIndex),\n"
    "    netease_japan_chart:",
    "    qq_japan_chart: qqJapanChartReadModel(snapshot?.qqJapanChart, snapshot?.qqJapanChartIndex),\n"
    "    qq_anime_chart: qqAnimeChartReadModel(snapshot?.qqAnimeChart, snapshot?.qqAnimeChartIndex),\n"
    "    netease_japan_chart:",
)
s = s.replace(
    "    netease_japan_chart: neteaseJapanChartReadModel(snapshot?.neteaseJapanChart),\n"
    "    kugou_japan_chart:",
    "    netease_japan_chart: neteaseJapanChartReadModel(snapshot?.neteaseJapanChart),\n"
    "    melon_jpop_chart: melonJpopChartReadModel(snapshot?.melonJpopChart),\n"
    "    kugou_japan_chart:",
)

start = s.index('async function hydrateServicePayload(')
end = s.index('\nfunction unchangedReadModel', start)
merged = """async function hydrateServicePayload(env, baseSnapshot, service, generatedAt) {
  const serviceId = String(service || '').trim();
  let payload = regionalMusicServiceReadModelPayload(baseSnapshot, serviceId, generatedAt);
  const r2 = env?.PAGES_RESPONSE_R2;
  if (typeof r2?.get !== 'function') return payload;

  const regionalSnapshot = await r2Json(r2, regionalSnapshotKey(serviceId));
  payload = mergeRegionalR2Snapshot(payload, regionalSnapshot);
  payload.read_model_version = REGIONAL_MUSIC_READ_MODEL_VERSION;
  payload.service = serviceId;
  const extraTimes = [regionalSnapshot?.updated_at];

  if (serviceId === 'qq_music') {
    const [japanView, japanIndex, animeView, animeIndex] = await Promise.all([
      r2Json(r2, QQ_JAPAN_HISTORY_VIEW_KEY),
      r2Json(r2, QQ_JAPAN_HISTORY_INDEX_KEY),
      r2Json(r2, QQ_ANIME_HISTORY_VIEW_KEY),
      r2Json(r2, QQ_ANIME_HISTORY_INDEX_KEY),
    ]);
    payload.qq_japan_chart = qqJapanChartReadModel(japanView, japanIndex);
    payload.qq_anime_chart = qqAnimeChartReadModel(animeView, animeIndex);
    extraTimes.push(japanView?.updated_at, japanIndex?.updated_at, animeView?.updated_at, animeIndex?.updated_at);
  } else if (serviceId === 'netease_cloud_music') {
    const view = await r2Json(r2, NETEASE_JAPAN_HISTORY_VIEW_KEY);
    payload.netease_japan_chart = neteaseJapanChartReadModel(view);
    extraTimes.push(view?.updated_at);
  } else if (serviceId === 'melon') {
    const view = await r2Json(r2, MELON_JPOP_HISTORY_VIEW_KEY);
    payload.melon_jpop_chart = melonJpopChartReadModel(view);
    extraTimes.push(view?.updated_at);
  }

  payload.source_updated_at = maximumTime([payload.source_updated_at, ...extraTimes]);
  payload.updated_at = Number(generatedAt) || Date.now();
  return payload;
}
"""
s = s[:start] + merged + s[end:]
src.write_text(s)

test = Path('worker/tests/regional-music-read-model.test.js')
t = test.read_text()
t = t.replace(
    "  publishRegionalMusicServiceReadModel,\n  qqJapanChartReadModel,",
    "  publishRegionalMusicServiceReadModel,\n"
    "  qqAnimeChartReadModel,\n"
    "  qqJapanChartReadModel,\n"
    "  melonJpopChartReadModel,",
)
t = t.replace(
    "import { QQ_JAPAN_HISTORY_VIEW_KEY } from '../src/qq-japan-chart-history-view.js';",
    "import { QQ_JAPAN_HISTORY_VIEW_KEY } from '../src/qq-japan-chart-history-view.js';\n"
    "import { QQ_ANIME_HISTORY_INDEX_KEY, QQ_ANIME_HISTORY_VIEW_KEY } from '../src/qq-anime-chart-history-view.js';\n"
    "import { MELON_JPOP_HISTORY_VIEW_KEY } from '../src/melon-jpop-history.js';",
)
t = t.replace(
    "  assert.deepEqual(payload.qq_japan_chart, { coverage:{}, history:[] });",
    "  assert.deepEqual(payload.qq_japan_chart, { coverage:{}, history:[] });\n"
    "  assert.deepEqual(payload.qq_anime_chart, { coverage:{}, history:[] });\n"
    "  assert.deepEqual(payload.melon_jpop_chart, { coverage:{}, periods:[], history:[] });",
)
t = t.replace(
    "  assert.equal('qq_japan_chart' in payload,false);",
    "  assert.equal('qq_japan_chart' in payload,false);\n"
    "  assert.equal('qq_anime_chart' in payload,false);\n"
    "  assert.equal('melon_jpop_chart' in payload,false);",
)
t = t.replace(
    "test('regional read model normalizes compact QQ Japan chart view', () => {",
    "test('regional read model normalizes compact QQ Japan and anime chart views', () => {",
)
t = t.replace(
    "  assert.equal(normalized.history.length, 2);\n});",
    "  assert.equal(normalized.history.length, 2);\n"
    "  assert.deepEqual(qqAnimeChartReadModel({ coverage:normalized.coverage, history:normalized.history }), normalized);\n"
    "});",
    1,
)

extra = """

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
"""
if 'Melon service publication owns Melon J-pop chart' not in t:
    t += extra
test.write_text(t)
