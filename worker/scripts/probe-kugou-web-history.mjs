const RANK_ID = 31312;
const cases = [
  { volid: 74328, expected_date: '2023-11-08' },
  { volid: 80379, expected_date: '2024-05-20' },
  { volid: 80836, expected_date: '2024-06-04' },
  { volid: 82749, expected_date: '2024-08-05' },
  { volid: 84646, expected_date: '2024-10-03' },
  { volid: 84901, expected_date: '2024-10-11' },
];
const aliases = ['櫻坂46','桜坂46','Sakurazaka46','樱坂46','日向坂46','Hinatazaka46','乃木坂46','Nogizaka46'];
const hosts = ['https://pc.service.kugou.com','https://www2.kugou.kugou.com'];

function snippets(text, needle, radius = 220) {
  const out = [];
  let from = 0;
  const lower = text.toLowerCase();
  const target = needle.toLowerCase();
  while (out.length < 8) {
    const i = lower.indexOf(target, from);
    if (i < 0) break;
    out.push(text.slice(Math.max(0, i - radius), Math.min(text.length, i + target.length + radius)).replace(/\s+/g, ' '));
    from = i + target.length;
  }
  return out;
}

function extractInteresting(text) {
  const date = text.match(/(20\d{2})[-\/.年](\d{1,2})[-\/.月](\d{1,2})/)?.[0] || null;
  const markers = {};
  for (const key of ['rankinfo','global.features','songs','songlist','rankList','rank_list','filename','songname','singername']) {
    const i = text.toLowerCase().indexOf(key.toLowerCase());
    if (i >= 0) markers[key] = text.slice(Math.max(0, i - 180), Math.min(text.length, i + 900)).replace(/\s+/g,' ');
  }
  const alias_hits = {};
  for (const alias of aliases) {
    const hit = snippets(text, alias);
    if (hit.length) alias_hits[alias] = hit;
  }
  const links = [...text.matchAll(/href=["']([^"']*31312[^"']*)["']/gi)].slice(0,80).map(m=>m[1]);
  return { date, markers, alias_hits, rank_links: [...new Set(links)] };
}

const out = { observed_at: new Date().toISOString(), rank_id: RANK_ID, pages: [] };
for (const item of cases) {
  for (const host of hosts) {
    for (const version of ['v9','v8']) {
      const url = `${host}/yueku/${version}/rank/home/1-${RANK_ID}-${item.volid}.html`;
      try {
        const response = await fetch(url, { redirect:'follow', headers:{ 'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36', accept:'text/html,application/xhtml+xml' }});
        const text = await response.text();
        out.pages.push({ expected_date:item.expected_date, volid:item.volid, host, version, url, final_url:response.url, status:response.status, ok:response.ok, length:text.length, content_type:response.headers.get('content-type'), ...extractInteresting(text), head:text.slice(0,500).replace(/\s+/g,' ') });
      } catch (error) {
        out.pages.push({ expected_date:item.expected_date, volid:item.volid, host, version, url, ok:false, error:String(error?.stack || error) });
      }
    }
  }
}
console.log(JSON.stringify(out,null,2));
