const RANK_ID = 31312;
const cases = [
  { volid: 74328, expected_date: '2023-11-08' },
  { volid: 80379, expected_date: '2024-05-20' },
  { volid: 80836, expected_date: '2024-06-04' },
  { volid: 82749, expected_date: '2024-08-05' },
  { volid: 84646, expected_date: '2024-10-03' },
  { volid: 84901, expected_date: '2024-10-11' },
];
const aliases = {
  sakurazaka46: ['櫻坂46','桜坂46','Sakurazaka46','樱坂46'],
  hinatazaka46: ['日向坂46','Hinatazaka46'],
  nogizaka46: ['乃木坂46','Nogizaka46'],
};

function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, '');
}
function groupFor(entry) {
  const haystack = normalize([entry?.singername, entry?.author_name, entry?.filename, entry?.songname].filter(Boolean).join(' '));
  for (const [group, names] of Object.entries(aliases)) if (names.some((name) => haystack.includes(normalize(name)))) return group;
  return null;
}
function extractJsonArrayAfter(text, marker) {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = text.indexOf('[', markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '[') depth += 1;
    else if (ch === ']' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}
function parseFeatures(text) {
  const raw = extractJsonArrayAfter(text, 'global.features');
  if (!raw) return { entries: [], error: 'global.features not found' };
  try { return { entries: JSON.parse(raw), error: null }; } catch (error) { return { entries: [], error: String(error) }; }
}
function singerFor(entry) {
  const singer = String(entry?.singername || '').trim();
  if (singer) return singer;
  const filename = String(entry?.filename || '').trim();
  const split = filename.indexOf(' - ');
  return split >= 0 ? filename.slice(0, split) : '';
}
function titleFor(entry) {
  const song = String(entry?.songname || '').trim();
  if (song) return song;
  const filename = String(entry?.filename || '').trim();
  const singer = singerFor(entry);
  if (singer && filename.startsWith(`${singer} - `)) return filename.slice(singer.length + 3);
  return filename;
}
function pageData(text, page) {
  const date = text.match(/(20\d{2})[-\/.年](\d{1,2})[-\/.月](\d{1,2})/)?.[0] || null;
  const parsed = parseFeatures(text);
  const matches = parsed.entries.flatMap((entry, index) => {
    const group = groupFor(entry);
    if (!group) return [];
    return [{ group, rank: (page - 1) * 30 + index + 1, singer: singerFor(entry), title: titleFor(entry), album_id: entry?.album_id ?? null, album_audio_id: entry?.album_audio_id ?? null, audio_id: entry?.audio_id ?? entry?.scid ?? null, hash: entry?.hash ?? entry?.HASH ?? null, last_day_rank: entry?.last_day_rank ?? null }];
  });
  return { date, feature_count: parsed.entries.length, parse_error: parsed.error, matches };
}

const out = { observed_at: new Date().toISOString(), rank_id: RANK_ID, pages: [] };
for (const item of cases) {
  for (let page = 1; page <= 4; page += 1) {
    const url = `https://pc.service.kugou.com/yueku/v8/rank/home/${page}-${RANK_ID}-${item.volid}.html`;
    try {
      const response = await fetch(url, { redirect:'follow', headers:{ 'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36', accept:'text/html,application/xhtml+xml' }});
      const text = await response.text();
      out.pages.push({ expected_date:item.expected_date, volid:item.volid, page, url, final_url:response.url, status:response.status, ok:response.ok, length:text.length, ...pageData(text, page) });
    } catch (error) {
      out.pages.push({ expected_date:item.expected_date, volid:item.volid, page, url, ok:false, error:String(error?.stack || error) });
    }
  }
}
console.log(JSON.stringify(out,null,2));
