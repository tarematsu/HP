// Read-only public HTML probe. No database or production credentials are used.
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extractGenieTrackIds, findGenieArtistId, parseGenieTrackTitle, parseGenieTrackMetrics } from '../src/regional-music-genie.js';
const run = promisify(execFile);
const output = process.argv[2] || '/tmp/genie-catalog-evidence';
await mkdir(output, { recursive: true });
const artists = [
  ['sakurazaka46', '80988607', ['Sakurazaka46', '櫻坂46']],
  ['nogizaka46', '80276120', ['Nogizaka46', '乃木坂46']],
  ['hinatazaka46', '80689952', ['Hinatazaka46', '日向坂46']],
];
async function html(url, data) {
  const args = ['--fail', '--silent', '--show-error', '--max-time', '30', url];
  if (data) args.push('--data', data);
  return (await run('curl', args, { maxBuffer: 4_000_000 })).stdout;
}
const results = [];
await Promise.all(artists.map(async ([artist, id, aliases]) => {
  const result = { artist, id, pages: [], samples: [] };
  try {
    const profile = await html(`https://www.genie.co.kr/detail/artistInfo?xxnm=${id}`);
    if (findGenieArtistId(profile, aliases) !== id) throw new Error('profile identity mismatch');
    const featured = new Set(extractGenieTrackIds(profile));
    const first = await html(`https://www.genie.co.kr/detail/artistSong?xxnm=${id}`);
    const total = Number(first.match(/총\s*<strong>([0-9,]+)<\/strong>/)?.[1]?.replaceAll(',', ''));
    if (!Number.isInteger(total) || total < 1 || total > 3000) throw new Error('invalid total');
    if (!first.includes('value="pop7"') || !first.includes('최근 1주 인기 곡')) throw new Error('popularity semantics not verified');
    result.advertised_total = total;
    const ids = [];
    const seen = new Set();
    for (let page = 1; page <= Math.ceil(total / 30); page++) {
      const body = page === 1 ? first : await html('https://www.genie.co.kr/detail/bArtistSongList', `xxnm=${id}&pg=${page}&pgsize=30&otype=pop7&stype=`);
      const rows = extractGenieTrackIds(body, 31);
      if (!rows.length || rows.length > 30 || rows.some(track => seen.has(track))) throw new Error(`invalid/repeated page ${page}`);
      for (const track of rows) { seen.add(track); ids.push(track); }
      result.pages.push({ page, count: rows.length });
      console.log(JSON.stringify({ artist, page, count: rows.length }));
    }
    result.track_ids = ids;
    result.unique_total = ids.length;
    result.catalog_complete = ids.length === total;
    const outsideFeatured = ids.filter(track => !featured.has(track));
    for (const track of [outsideFeatured[0], outsideFeatured.at(-1)].filter(Boolean)) {
      const body = await html(`https://www.genie.co.kr/detail/songInfo?xgnm=${track}`);
      result.samples.push({ track, identity_verified: findGenieArtistId(body, aliases) === id, title: parseGenieTrackTitle(body), ...parseGenieTrackMetrics(body) });
    }
  } catch (error) { result.error = error.message; }
  results.push(result);
  await writeFile(`${output}/${artist}.json`, JSON.stringify(result, null, 2));
}));
await writeFile(`${output}/summary.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map(({ track_ids, ...result }) => result)));
if (results.some(result => result.error || !result.catalog_complete || result.samples.some(sample => !sample.identity_verified || sample.plays === null))) process.exitCode = 1;
