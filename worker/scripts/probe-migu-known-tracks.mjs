import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUT_DIR = new URL('../migu-sakamichi-evidence/', import.meta.url);
const SEARCH_URL = 'https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/search_all.do';
const DEVICE_ID = '963B7AA0D21511ED807EE5846EC87D20';
const SIGN_KEY = '6cdc72a439cef99a3418d2a78aa28c73';

const GROUPS = [
  { key: 'sakurazaka46', artist: '櫻坂46', aliases: ['櫻坂46', '樱坂46', 'Sakurazaka46', 'Sakurazaka 46'], tracks: ['Start over!', '承認欲求', '何歳の頃に戻りたいのか？', 'UDAGAWA GENERATION'] },
  { key: 'nogizaka46', artist: '乃木坂46', aliases: ['乃木坂46', 'Nogizaka46', 'Nogizaka 46'], tracks: ['インフルエンサー', 'シンクロニシティ', 'チートデイ'] },
  { key: 'hinatazaka46', artist: '日向坂46', aliases: ['日向坂46', 'Hinatazaka46', 'Hinatazaka 46'], tracks: ['キュン', 'ドレミソラシド', '絶対的第六感'] },
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s\u3000·・._\-—–!！?？()（）\[\]【】]/g, '');
const md5 = value => createHash('md5').update(value).digest('hex');
const sign = (timestamp, keyword) => md5(`${keyword}${SIGN_KEY}yyapp2d16148780a1dcc7408e06336b98cfd50${DEVICE_ID}${timestamp}`);

function songs(body) {
  const out = [];
  for (const row of body?.songResultData?.resultList || []) {
    const items = Array.isArray(row) ? row : [row];
    for (const item of items) if (item && typeof item === 'object') out.push(item);
  }
  return out;
}

async function search(keyword) {
  const timestamp = Date.now();
  const params = new URLSearchParams({
    ua: 'Android_migu', version: '5.0.1', text: keyword, pageNo: '1', pageSize: '20',
    searchSwitch: JSON.stringify({ song: 1, album: 0, singer: 0, tagSong: 0, mvSong: 0, songlist: 0, bestShow: 1 }),
    isCopyright: '1', isCorrect: '1', sort: '0',
  });
  const response = await fetch(`${SEARCH_URL}?${params}`, {
    headers: {
      accept: 'application/json,text/plain,*/*', sign: sign(timestamp, keyword), timestamp: String(timestamp),
      appId: 'yyapp2', mode: 'android', ua: 'Android_migu', version: '6.9.4', osVersion: 'android 7.0', deviceId: DEVICE_ID,
      'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36',
    },
  });
  return { ok: response.ok, status: response.status, body: await response.json() };
}

await mkdir(OUT_DIR, { recursive: true });
const results = [];
for (const group of GROUPS) {
  for (const title of group.tracks) {
    for (const query of [title, `${title} ${group.artist}`]) {
      try {
        const response = await search(query);
        const list = songs(response.body);
        const exactTitle = list.filter(item => normalize(item.name) === normalize(title));
        const exactArtist = exactTitle.filter(item => (item.singers || []).some(singer => group.aliases.some(alias => normalize(singer?.name) === normalize(alias))));
        results.push({
          group: group.key,
          title,
          query,
          http_status: response.status,
          api_code: response.body?.code ?? null,
          total_count: response.body?.songResultData?.totalCount ?? null,
          exact_title_hits: exactTitle.map(item => ({
            id: item.id ?? null,
            contentId: item.contentId ?? null,
            copyrightId: item.copyrightId ?? null,
            name: item.name ?? null,
            singers: (item.singers || []).map(singer => ({ id: singer.id ?? null, name: singer.name ?? null })),
            albums: (item.albums || []).map(album => ({ id: album.id ?? null, name: album.name ?? null })),
            tags: item.tags || [],
          })),
          exact_artist_hits: exactArtist.map(item => ({ id: item.id ?? null, contentId: item.contentId ?? null, name: item.name ?? null })),
        });
        const file = `known-${group.key}-${Buffer.from(query).toString('hex')}.json`;
        await writeFile(join(OUT_DIR.pathname, file), `${JSON.stringify(response, null, 2)}\n`, 'utf8');
      } catch (error) {
        results.push({ group: group.key, title, query, error: String(error?.stack || error) });
      }
      await sleep(250);
    }
  }
}

await writeFile(join(OUT_DIR.pathname, 'known-tracks-summary.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(results.map(row => ({
  group: row.group,
  title: row.title,
  query: row.query,
  status: row.http_status,
  total: row.total_count,
  exact_title_hits: row.exact_title_hits?.length || 0,
  exact_artist_hits: row.exact_artist_hits?.length || 0,
})), null, 2));
