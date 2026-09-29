from pathlib import Path
import re


def must_replace(s, old, new, count=1, label='replacement'):
    actual = s.count(old)
    if actual < count:
        raise SystemExit(f'{label}: expected >= {count}, got {actual}')
    return s.replace(old, new, count)


p = Path('worker/src/amazon-music-web-client.js')
s = p.read_text()
s = must_replace(s,
    "const MAX_TRACKS = 500;\nconst USER_HASH = JSON.stringify({ level: 'LIBRARY_MEMBER' });",
    "const MAX_TRACKS = 500;\nconst MAX_OVERALL_CHART_PAGES = 550;\nconst OVERALL_CHART_PAGE_URL = `${AMAZON_ORIGIN}/popular/songs/browsePanel/popularTracks`;\nconst OVERALL_CHART_INITIAL_URL = `${CATALOG_SKILL_BASE}/showChartsWidget?genreTitle=browsePanel&genreId=popularTracks&widgetId=top-songs&userHash=%7B%22level%22%3A%22LIBRARY_MEMBER%22%7D`;\nconst OVERALL_CHART_RETRY_ATTEMPTS = 6;\nconst USER_HASH = JSON.stringify({ level: 'LIBRARY_MEMBER' });",
    label='client constants')
s = must_replace(s, "function isErrorOnlyPayload(document) {", """function nextChartsWidgetUrl(document) {
  let found = null;
  deepValues(document, (node) => {
    if (found) return;
    for (const value of Object.values(node)) {
      if (typeof value !== 'string'
        || !value.includes('/api/showChartsWidget?')
        || !value.includes('widgetId=top-songs')
        || !value.includes('next=')) continue;
      try {
        found = new URL(value, CATALOG_SKILL_BASE).toString();
        return;
      } catch {
        // Ignore malformed action URLs.
      }
    }
  });
  return found;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isErrorOnlyPayload(document) {""", label='chart next helper')
s = must_replace(s, "    async fetchPlaylist(playlistId) {", """    async fetchOverallTrackRanks(targetIds = null) {
      await primeWebPlayer(fetchImpl, 'B08P3RHP1P');
      const targets = targetIds == null
        ? null
        : new Set([...targetIds].map((value) => text(value)).filter(Boolean));
      const hits = [];
      const seenUrls = new Set();
      const seenTrackIds = new Set();
      let url = OVERALL_CHART_INITIAL_URL;
      let scannedTracks = 0;
      let exhausted = false;

      for (let page = 0; page < MAX_OVERALL_CHART_PAGES; page += 1) {
        if (!url || seenUrls.has(url)) {
          exhausted = true;
          break;
        }
        seenUrls.add(url);

        let document = null;
        for (let attempt = 0; attempt < OVERALL_CHART_RETRY_ATTEMPTS; attempt += 1) {
          const configuration = await config(fetchImpl);
          const response = await fetchImpl(url, {
            method: 'POST',
            headers: outerHeaders(),
            body: JSON.stringify({
              headers: JSON.stringify(amazonHeaders(configuration, OVERALL_CHART_PAGE_URL)),
            }),
          });
          if (response.status === 429) {
            await sleep(Math.min(15_000, 1_000 * (2 ** attempt)));
            continue;
          }
          document = await responseJson(response, 'Amazon Music overall chart');
          if (isErrorOnlyPayload(document)) {
            throw new Error('Amazon Music overall chart returned an error template');
          }
          break;
        }
        if (!document) throw new Error('Amazon Music overall chart rate-limit retries exhausted');

        const pageTracks = extractAmazonMusicTracks(document);
        const fresh = pageTracks.filter((track) => {
          const id = text(track?.amazon_music_id);
          return id && !seenTrackIds.has(id);
        });
        if (!fresh.length) {
          exhausted = true;
          break;
        }
        for (const track of fresh) {
          seenTrackIds.add(track.amazon_music_id);
          scannedTracks += 1;
          if (!targets || targets.has(track.amazon_music_id)) {
            hits.push({ ...track, rank: scannedTracks });
          }
        }
        if (targets && hits.length >= targets.size) {
          exhausted = true;
          break;
        }
        const next = nextChartsWidgetUrl(document);
        if (!next || seenUrls.has(next)) {
          exhausted = true;
          break;
        }
        url = next;
      }
      return { hits, scanned_tracks: scannedTracks, exhausted };
    },

    async fetchPlaylist(playlistId) {""", label='overall chart method')
p.write_text(s)

p = Path('worker/src/amazon-music-collector.js')
s = p.read_text()
old_map = "const popularRank = new Map((snapshot.popular_tracks || [])\n    .map((track) => [track.amazon_music_id, Number(track.rank) || null]));"
if s.count(old_map) != 2:
    raise SystemExit(f'collector rank maps: expected 2, got {s.count(old_map)}')
s = s.replace(old_map, "const overallRank = new Map((snapshot.catalog_popular_hits || [])\n    .map((track) => [track.amazon_music_id, Number(track.rank) || null]));")
for old, new in [
    ("      amazon_rank: Number(track.rank) || null,\n      popular_rank: popularRank.get(track.amazon_music_id) ?? null,",
     "      amazon_rank: overallRank.get(track.amazon_music_id) ?? null,\n      popular_rank: Number(track.rank) || null,"),
    ("    amazon_rank: Number(track.rank) || null,\n    popular_rank: popularRank.get(track.amazon_music_id) ?? null,",
     "    amazon_rank: overallRank.get(track.amazon_music_id) ?? null,\n    popular_rank: Number(track.rank) || null,"),
]:
    if old not in s:
        raise SystemExit(f'collector rank pair missing: {old!r}')
    s = s.replace(old, new, 1)
s = must_replace(s,
    "  const [artistDocument, rawArtistTracks, top50Document, popularHtml] = await Promise.all([\n    client.fetchArtist(AMAZON_MUSIC_ARTIST_ID),\n    client.fetchArtistTracks(AMAZON_MUSIC_ARTIST_ID),\n    client.fetchPlaylist(AMAZON_MUSIC_JAPAN_TOP50_ID),\n    client.fetchPopularPageHtml().catch(() => ''),\n  ]);",
    "  const [artistDocument, rawArtistTracks, top50Document] = await Promise.all([\n    client.fetchArtist(AMAZON_MUSIC_ARTIST_ID),\n    client.fetchArtistTracks(AMAZON_MUSIC_ARTIST_ID),\n    client.fetchPlaylist(AMAZON_MUSIC_JAPAN_TOP50_ID),\n  ]);",
    label='collector fetches')
s = must_replace(s,
    "  const top50Ranking = rankTracks(extractAmazonMusicTracks(top50Document));\n  const top50Hits = hitsFromRanking(top50Ranking, artistIds).map((track) => publicTrack(track, trackIdByAmazonId));\n  const catalogRanking = rankTracks(extractAmazonMusicTracks(popularHtml));\n  const catalogHits = hitsFromRanking(catalogRanking, artistIds).map((track) => publicTrack(track, trackIdByAmazonId));\n  const follower = await followerInfo(client, artistDocument);",
    "  const top50Ranking = rankTracks(extractAmazonMusicTracks(top50Document));\n  const top50Hits = hitsFromRanking(top50Ranking, artistIds).map((track) => publicTrack(track, trackIdByAmazonId));\n  const overallRanking = typeof client.fetchOverallTrackRanks === 'function'\n    ? await client.fetchOverallTrackRanks(artistIds)\n    : { hits: [], scanned_tracks: 0, exhausted: false };\n  const catalogHits = hitsFromRanking(\n    Array.isArray(overallRanking?.hits) ? overallRanking.hits : [],\n    artistIds,\n  ).map((track) => publicTrack(track, trackIdByAmazonId));\n  const follower = await followerInfo(client, artistDocument);",
    label='collector overall ranking')
s = must_replace(s,
    "    catalog_popular_hits: catalogHits,\n    japan_top_50: top50Hits.length ? { week_key: weekKey, hits: top50Hits } : null,",
    "    catalog_popular_hits: catalogHits,\n    catalog_popular_scanned: Number(overallRanking?.scanned_tracks) || 0,\n    catalog_popular_exhausted: Boolean(overallRanking?.exhausted),\n    japan_top_50: top50Hits.length ? { week_key: weekKey, hits: top50Hits } : null,",
    label='snapshot chart metadata')
s = must_replace(s,
    "        observed_at: observedAt,\n        hits: catalogHits,",
    "        observed_at: observedAt,\n        scanned_tracks: Number(overallRanking?.scanned_tracks) || 0,\n        exhausted: Boolean(overallRanking?.exhausted),\n        hits: catalogHits,",
    label='catalog stored metadata')
s = must_replace(s,
    "    catalog_popular_hits: catalogHits.length,\n    catalog_popular_stored: catalogStored,",
    "    catalog_popular_hits: catalogHits.length,\n    catalog_popular_scanned: Number(overallRanking?.scanned_tracks) || 0,\n    catalog_popular_exhausted: Boolean(overallRanking?.exhausted),\n    catalog_popular_stored: catalogStored,",
    label='collector result metadata')
p.write_text(s)

p = Path('worker/tests/amazon-music-collector.test.js')
s = p.read_text()
s, n = re.subn(r"    async fetchPopularPageHtml\(\) \{.*?\n    \},", """    async fetchOverallTrackRanks() {
      return {
        scanned_tracks: 10020,
        exhausted: true,
        hits: [{ amazon_music_id: 'A1', title: 'Song A', artist: '櫻坂46', rank: 42 }],
      };
    },""", s, count=1, flags=re.S)
if n != 1:
    raise SystemExit(f'test mock replacement count={n}')
s = must_replace(s,
    "  assert.equal(result.catalog_popular_hits, 1);\n  assert.equal(result.read_model_published, true);",
    "  assert.equal(result.catalog_popular_hits, 1);\n  assert.equal(result.catalog_popular_scanned, 10020);\n  assert.equal(result.catalog_popular_exhausted, true);\n  assert.equal(result.read_model_published, true);",
    label='test collector metrics')
s = must_replace(s,
    "  assert.deepEqual(readModel.tracks.map((track) => track.amazon_rank), [1, 2, 3]);\n  assert.equal(readModel.tracks[0].popular_rank, null);\n  assert.equal(readModel.tracks[1].popular_rank, 1);\n  assert.equal(readModel.tracks[2].popular_rank, 2);",
    "  assert.deepEqual(readModel.tracks.map((track) => track.amazon_rank), [null, 42, null]);\n  assert.deepEqual(readModel.tracks.map((track) => track.popular_rank), [1, 2, 3]);",
    label='test rank semantics')
p.write_text(s)

p = Path('site/public/amazon-music-shell.js')
s = p.read_text().replace('全楽曲 Amazon内順位推移', '全楽曲 Amazon総合順位推移').replace('Amazon内順位</th>', 'Amazon総合順位</th>').replace('櫻坂46全楽曲のAmazon Music内順位推移', '櫻坂46全楽曲のAmazon Music総合順位推移')
p.write_text(s)
p = Path('site/public/amazon-music.js')
s = p.read_text().replace('Amazon Music順位の履歴はまだありません。', 'Amazon Music総合順位の履歴はまだありません。').replace('櫻坂46全楽曲のAmazon Music内順位推移。1位が上。', '櫻坂46全楽曲のAmazon Music総合順位推移。1位が上。')
p.write_text(s)
p = Path('site/tests/amazon-music-tab.test.js')
s = p.read_text().replace('櫻坂46全楽曲のAmazon Music内順位推移。1位が上。', '櫻坂46全楽曲のAmazon Music総合順位推移。1位が上。')
p.write_text(s)
