import crypto from 'node:crypto';

const APPID = 1005;
const CLIENTVER = 20489;
const SALT = 'OIlwieks28dk2k092lksi2UIkp';
const RANK_ID = 31312;
const GUID = '8d6d3bb0-7c71-4acd-a6e4-9ebf8ec1d842';

function md5(value) {
  return crypto.createHash('md5').update(value).digest('hex');
}

function calculateMid(guid) {
  return BigInt(`0x${md5(guid)}`).toString(10);
}

function androidSignature(params, data) {
  const paramsString = Object.keys(params)
    .sort()
    .map((key) => `${key}=${typeof params[key] === 'object' ? JSON.stringify(params[key]) : params[key]}`)
    .join('');
  return md5(`${SALT}${paramsString}${data || ''}${SALT}`);
}

function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, '');
}

const aliases = {
  sakurazaka46: ['櫻坂46', '桜坂46', 'Sakurazaka46', '樱坂46'],
  hinatazaka46: ['日向坂46', 'Hinatazaka46'],
  nogizaka46: ['乃木坂46', 'Nogizaka46'],
};

function groupFor(entry) {
  const haystack = normalize([
    entry?.singername,
    entry?.singer_name,
    entry?.author_name,
    entry?.filename,
    entry?.songname,
    entry?.song_name,
  ].filter(Boolean).join(' '));
  for (const [group, names] of Object.entries(aliases)) {
    if (names.some((name) => haystack.includes(normalize(name)))) return group;
  }
  return null;
}

function findArrays(value, path = '$', depth = 0, found = []) {
  if (depth > 7 || value == null) return found;
  if (Array.isArray(value)) {
    if (value.length && value.some((x) => x && typeof x === 'object')) {
      found.push({ path, length: value.length, sample_keys: Object.keys(value.find((x) => x && typeof x === 'object') || {}) });
    }
    return found;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) findArrays(child, `${path}.${key}`, depth + 1, found);
  }
  return found;
}

function candidateEntries(json) {
  const candidates = [
    json?.data?.info,
    json?.data?.list,
    json?.data?.song_list,
    json?.data?.songs,
    json?.data?.data,
    json?.info,
    json?.list,
    json?.songs,
  ];
  for (const value of candidates) if (Array.isArray(value)) return value;
  return [];
}

const mid = calculateMid(GUID);
const clienttime = Math.floor(Date.now() / 1000);
const bodyObject = {
  show_portrait_mv: 1,
  show_type_total: 1,
  filter_original_remarks: 1,
  area_code: 1,
  pagesize: 100,
  rank_cid: 0,
  type: 1,
  page: 1,
  rank_id: RANK_ID,
};
const body = JSON.stringify(bodyObject);
const params = {
  dfid: '-',
  mid,
  uuid: '-',
  appid: APPID,
  clientver: CLIENTVER,
  clienttime,
};
params.signature = androidSignature(params, body);
const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString();
const url = `https://gateway.kugou.com/openapi/kmr/v2/rank/audio?${query}`;

const headers = {
  'content-type': 'application/json',
  accept: 'application/json,text/plain,*/*',
  'user-agent': 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi',
  'kg-tid': '369',
  dfid: '-',
  mid,
  clienttime: String(clienttime),
  'kg-rc': '1',
  'kg-thash': '5d816a0',
  'kg-rec': '1',
  'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
};

const out = {
  observed_at: new Date().toISOString(),
  request: {
    rank_id: RANK_ID,
    page: 1,
    pagesize: 100,
    appid: APPID,
    clientver: CLIENTVER,
    anonymous: true,
  },
};

try {
  const response = await fetch(url, { method: 'POST', headers, body });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  const entries = json ? candidateEntries(json) : [];
  out.response = {
    http_status: response.status,
    ok: response.ok,
    ssa_code: response.headers.get('ssa-code'),
    top_keys: json && typeof json === 'object' ? Object.keys(json) : [],
    data_keys: json?.data && typeof json.data === 'object' ? Object.keys(json.data) : [],
    api_status: json?.status ?? null,
    error_code: json?.error_code ?? json?.errcode ?? null,
    error: json?.error ?? json?.errmsg ?? json?.msg ?? null,
    arrays: json ? findArrays(json) : [],
    entry_count: entries.length,
    matches: {
      sakurazaka46: entries.map((entry, index) => ({ entry, rank: index + 1 })).filter(({ entry }) => groupFor(entry) === 'sakurazaka46'),
      hinatazaka46: entries.map((entry, index) => ({ entry, rank: index + 1 })).filter(({ entry }) => groupFor(entry) === 'hinatazaka46'),
      nogizaka46: entries.map((entry, index) => ({ entry, rank: index + 1 })).filter(({ entry }) => groupFor(entry) === 'nogizaka46'),
    },
    first_30: entries.slice(0, 30),
    body_sample: text.slice(0, 30000),
  };
} catch (error) {
  out.response = { ok: false, transport_error: String(error?.stack || error) };
}

console.log(JSON.stringify(out, null, 2));
