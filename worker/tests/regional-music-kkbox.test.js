import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KKBOX_CHARTS,
  canonicalKkboxArtists,
  collectKkbox,
  kkboxChartApiUrl,
  parseKkboxChartPayload,
} from '../src/regional-music-kkbox.js';

function responseFor(url) {
  const type = new URL(url).searchParams.get('type');
  return {
    ok: true,
    status: 200,
    headers: { get() { return null; } },
    async json() {
      return {
        code: '0',
        message: '',
        data: {
          date: '2026-10-01',
          charts: {
            [type]: [
              {
                rankings: { this_period: 4, last_period: 9 },
                song_id: 'multi-track',
                song_name: 'Audition',
                artist_name: '坂道選抜, 乃木坂46, 櫻坂46, 日向坂46',
                artist_roles: '坂道選抜, 乃木坂46, 櫻坂46, 日向坂46',
                album_name: 'Audition',
                song_url: 'https://www.kkbox.com/tw/tc/song/multi-track',
              },
              {
                rankings: { this_period: 31, last_period: null },
                song_id: 'sakura-track',
                song_name: '愛MUST BE',
                artist_name: '櫻坂46',
                artist_roles: '櫻坂46',
                album_name: 'Unhappy birthday構文',
                song_url: 'https://www.kkbox.com/tw/tc/song/sakura-track',
              },
              {
                rankings: { this_period: 1, last_period: 1 },
                song_id: 'other-track',
                song_name: 'Other',
                artist_name: 'Other Artist',
              },
            ],
          },
        },
      };
    },
  };
}

test('KKBOX chart URL uses the live KMA Japanese category endpoint', () => {
  const url = new URL(kkboxChartApiUrl({
    territory: 'tw',
    period: 'weekly',
    type: 'newrelease',
    date: '2024-10-03',
  }));
  assert.equal(url.origin + url.pathname, 'https://kma.kkbox.com/charts/api/v1/weekly');
  assert.equal(url.searchParams.get('category'), '308');
  assert.equal(url.searchParams.get('terr'), 'tw');
  assert.equal(url.searchParams.get('type'), 'newrelease');
  assert.equal(url.searchParams.get('date'), '2024-10-03');
});

test('KKBOX target matching preserves multi-group Sakamichi collaborations', () => {
  assert.deepEqual(canonicalKkboxArtists('坂道選抜, 乃木坂46, 櫻坂46, 日向坂46'), [
    'sakurazaka46',
    'hinatazaka46',
    'nogizaka46',
  ]);
});

test('KKBOX parser filters the chart to tracked Sakamichi entries and keeps ranks', async () => {
  const chart = { territory: 'tw', period: 'weekly', type: 'newrelease' };
  const payload = await responseFor(kkboxChartApiUrl(chart)).json();
  const parsed = parseKkboxChartPayload(payload, chart);
  assert.equal(parsed.provider_date, '2026-10-01');
  assert.equal(parsed.source_rows, 3);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[0].rank, 4);
  assert.equal(parsed.entries[0].previous_rank, 9);
  assert.deepEqual(parsed.entries[0].canonical_artists, ['sakurazaka46', 'hinatazaka46', 'nogizaka46']);
  assert.equal(parsed.entries[1].title, '愛MUST BE');
});

test('KKBOX collector persists all eight TW/HK daily/weekly chart identities to the snapshot store', async () => {
  const writes = [];
  const env = {
    REGIONAL_MUSIC_SNAPSHOT_STORE: async (field, value) => writes.push({ field, value }),
  };
  const result = await collectKkbox(env, 1234, async (url) => responseFor(url), {
    requestDelayMs: 0,
    sleepImpl: async () => {},
  });
  assert.equal(KKBOX_CHARTS.length, 8);
  assert.equal(result.status, 'ok');
  assert.equal(result.charts, 8);
  assert.equal(result.tracks, 2);
  assert.equal(result.playlist_memberships, 16);
  assert.equal(writes.filter((row) => row.field === 'playlists').length, 8);
  assert.equal(writes.filter((row) => row.field === 'playlist_snapshots').length, 8);
  assert.equal(writes.filter((row) => row.field === 'state').at(-1).value.service, 'kkbox');
});
