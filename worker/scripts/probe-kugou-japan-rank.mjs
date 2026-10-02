const headers = {
  accept: 'application/json,text/plain,*/*',
  referer: 'https://m.kugou.com/',
  'user-agent': 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36',
};

const aliases = {
  sakurazaka46: ['櫻坂46', '桜坂46', 'Sakurazaka46', '樱坂46'],
  hinatazaka46: ['日向坂46', 'Hinatazaka46'],
  nogizaka46: ['乃木坂46', 'Nogizaka46'],
};

function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, '');
}

function identifyGroup(entry) {
  const haystack = normalize([
    entry?.singername,
    entry?.SingerName,
    entry?.filename,
    entry?.FileName,
    entry?.songname,
    entry?.SongName,
  ].filter(Boolean).join(' '));
  for (const [canonical, names] of Object.entries(aliases)) {
    if (names.some((name) => haystack.includes(normalize(name)))) return canonical;
  }
  return null;
}

function summarize(entry, rank, page) {
  return {
    rank,
    page,
    singername: entry?.singername ?? entry?.SingerName ?? null,
    songname: entry?.songname ?? entry?.SongName ?? null,
    filename: entry?.filename ?? entry?.FileName ?? null,
    album_name: entry?.album_name ?? entry?.AlbumName ?? null,
    album_audio_id: entry?.album_audio_id ?? entry?.MixSongID ?? null,
    audio_id: entry?.audio_id ?? entry?.Audioid ?? null,
    hash: entry?.hash ?? entry?.FileHash ?? null,
    mvhash: entry?.mvhash ?? entry?.MvHash ?? null,
    ownercount: entry?.ownercount ?? entry?.OwnerCount ?? null,
    group: identifyGroup(entry),
  };
}

async function fetchPage(page) {
  const url = `https://m.kugou.com/rank/info/?rankid=31312&page=${page}&json=true`;
  try {
    const response = await fetch(url, { headers });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const list = json?.songs?.list;
    return {
      page,
      url,
      http_status: response.status,
      ok: response.ok,
      rank_name: json?.info?.rankname ?? null,
      update_frequency: json?.info?.update_frequency ?? null,
      intro: json?.info?.intro ?? null,
      total: json?.songs?.total ?? null,
      list: Array.isArray(list) ? list : [],
      body_sample: json ? null : text.slice(0, 1000),
    };
  } catch (error) {
    return {
      page,
      url,
      http_status: null,
      ok: false,
      error: String(error?.message || error),
      list: [],
    };
  }
}

const pages = [];
const entries = [];
const seen = new Set();
let nextRank = 1;

for (let page = 1; page <= 5; page += 1) {
  const result = await fetchPage(page);
  pages.push({
    page: result.page,
    url: result.url,
    http_status: result.http_status,
    ok: result.ok,
    rank_name: result.rank_name ?? null,
    update_frequency: result.update_frequency ?? null,
    intro: result.intro ?? null,
    total: result.total ?? null,
    list_count: result.list.length,
    error: result.error ?? null,
    body_sample: result.body_sample ?? null,
  });
  for (const item of result.list) {
    const key = String(item?.hash || item?.FileHash || item?.album_audio_id || item?.filename || JSON.stringify(item));
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(summarize(item, nextRank, page));
    nextRank += 1;
  }
}

const matches = {
  sakurazaka46: entries.filter((entry) => entry.group === 'sakurazaka46'),
  hinatazaka46: entries.filter((entry) => entry.group === 'hinatazaka46'),
  nogizaka46: entries.filter((entry) => entry.group === 'nogizaka46'),
};

console.log(JSON.stringify({
  observed_at: new Date().toISOString(),
  rank_id: 31312,
  requested_pages: 5,
  pages,
  unique_entries: entries.length,
  matches,
  entries,
}, null, 2));
