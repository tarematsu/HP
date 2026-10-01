import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  locale: 'ja-JP',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
});

const TARGET_TRACK_ID = 'B0DJLRN1LF';
const USER_HASH = JSON.stringify({ level: 'LIBRARY_MEMBER' });
let capturedHeaders = null;
const events = [];
const push = (value) => events.push(value);

function deepStrings(value, out = [], depth = 0) {
  if (depth > 16 || value == null || out.length > 3000) return out;
  if (typeof value === 'string') { out.push(value); return out; }
  if (Array.isArray(value)) { value.forEach((v) => deepStrings(v, out, depth + 1)); return out; }
  if (typeof value === 'object') Object.values(value).forEach((v) => deepStrings(v, out, depth + 1));
  return out;
}

function summarize(payload) {
  const strings = deepStrings(payload);
  const playlists = [...new Set(strings.flatMap((value) => {
    const matches = [...String(value).matchAll(/\/(?:user-)?playlists\/([A-Za-z0-9_-]+)/giu)];
    return matches.map((m) => m[1]);
  }))].slice(0, 50);
  const targetMentions = strings.filter((value) => String(value).includes(TARGET_TRACK_ID)).length;
  const urls = [...new Set(strings.filter((value) => /searchCatalogPlaylists|showCatalogPlaylist|\/playlists\//iu.test(String(value))))].slice(0, 30);
  return { playlists, target_mentions: targetMentions, urls };
}

page.on('request', (request) => {
  if (!request.url().endsWith('/api/showSearch')) return;
  try {
    const body = JSON.parse(request.postData() || '{}');
    if (body.headers) capturedHeaders = body.headers;
  } catch {}
});

await page.goto('https://music.amazon.co.jp/search/TOKYO%20SNOW%20%E6%AB%BB%E5%9D%8246', {
  waitUntil: 'domcontentloaded', timeout: 60000,
});
await page.waitForTimeout(5000);

if (!capturedHeaders) throw new Error('showSearch headers were not captured');

const candidates = [
  { name: 'catalog-trackId', base: 'https://fe.mesk.skill.music.a2z.com/api', path: '/searchCatalogPlaylists', request: { trackId: TARGET_TRACK_ID, userHash: USER_HASH } },
  { name: 'catalog-id', base: 'https://fe.mesk.skill.music.a2z.com/api', path: '/searchCatalogPlaylists', request: { id: TARGET_TRACK_ID, userHash: USER_HASH } },
  { name: 'catalog-empty-keyword-trackId', base: 'https://fe.mesk.skill.music.a2z.com/api', path: '/searchCatalogPlaylists', request: { keyword: '', trackId: TARGET_TRACK_ID, userHash: USER_HASH } },
  { name: 'catalog-trackid-keyword', base: 'https://fe.mesk.skill.music.a2z.com/api', path: '/searchCatalogPlaylists', request: { keyword: TARGET_TRACK_ID, userHash: USER_HASH } },
  { name: 'web-filter-TrackId', base: 'https://fe.web.skill.music.a2z.com/api', path: '/showSearch', request: { filter: JSON.stringify({ IsLibrary: ['false'], TrackId: [TARGET_TRACK_ID] }), keyword: JSON.stringify({ interface: 'Web.TemplatesInterface.v1_0.Touch.SearchTemplateInterface.SearchKeywordClientInformation', keyword: '' }), suggestedKeyword: '', userHash: USER_HASH } },
  { name: 'web-filter-trackId', base: 'https://fe.web.skill.music.a2z.com/api', path: '/showSearch', request: { filter: JSON.stringify({ IsLibrary: ['false'], trackId: [TARGET_TRACK_ID] }), keyword: JSON.stringify({ interface: 'Web.TemplatesInterface.v1_0.Touch.SearchTemplateInterface.SearchKeywordClientInformation', keyword: '' }), suggestedKeyword: '', userHash: USER_HASH } },
];

for (const candidate of candidates) {
  const result = await page.evaluate(async ({ candidate, capturedHeaders }) => {
    try {
      const response = await fetch(candidate.base + candidate.path, {
        method: 'POST',
        headers: { accept: '*/*', 'content-type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ ...candidate.request, headers: capturedHeaders }),
      });
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      return { status: response.status, ok: response.ok, text: json ? null : text.slice(0, 2000), json };
    } catch (error) {
      return { status: 0, ok: false, text: String(error?.message || error), json: null };
    }
  }, { candidate, capturedHeaders });
  push({ type: 'candidate', name: candidate.name, request: candidate.request, status: result.status, ok: result.ok, error: result.text, summary: result.json ? summarize(result.json) : null });

  const playlistIds = result.json ? summarize(result.json).playlists.slice(0, 5) : [];
  for (const playlistId of playlistIds) {
    const detail = await page.evaluate(async ({ playlistId, capturedHeaders, userHash }) => {
      try {
        const response = await fetch('https://fe.mesk.skill.music.a2z.com/api/showCatalogPlaylist', {
          method: 'POST',
          headers: { accept: '*/*', 'content-type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify({ id: playlistId, userHash, headers: capturedHeaders }),
        });
        const text = await response.text();
        let json = null;
        try { json = JSON.parse(text); } catch {}
        return { status: response.status, json, text: json ? null : text.slice(0, 1000) };
      } catch (error) { return { status: 0, json: null, text: String(error?.message || error) }; }
    }, { playlistId, capturedHeaders, userHash: USER_HASH });
    push({ type: 'playlist-verify', candidate: candidate.name, playlist_id: playlistId, status: detail.status, contains_target: detail.json ? deepStrings(detail.json).some((v) => String(v).includes(TARGET_TRACK_ID)) : false, summary: detail.json ? summarize(detail.json) : null, error: detail.text });
  }
}

console.log(JSON.stringify(events, null, 2));
await browser.close();
