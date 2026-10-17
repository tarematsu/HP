import assert from 'node:assert/strict';
import test from 'node:test';
import { auditSpotifyCharts, auditSpotifyD1 } from '../.github/scripts/audit-spotify-collection.mjs';
import { SPOTIFY_CHART_SOURCES } from '../packages/sh-shared/spotify-charts.mjs';
import { SPOTIFY_MONTHLY_LISTENER_ARTISTS } from '../worker/src/spotify-monthly-listeners.js';
const now = Date.parse('2026-10-18T01:00:00Z');
function r2(mutate = () => {}) {
  return { async get(key) {
    const spec = SPOTIFY_CHART_SOURCES.find(item => key.includes(item.id));
    if (!spec) throw Error('unexpected private key');
    let value = key.startsWith('spotify/charts/state/')
      ? { chart_id: spec.id, latest_status: 'ok', observed_at: now, latest_chart_date: '2026-10-17', history_complete: false }
      : { chart_id: spec.id, periods: [{ chart_date: '2026-10-17', status: 'ok', entries: [] }] };
    value = mutate(value, key) ?? value;
    return { json: async () => value };
  } };
}
test('all configured charts and playlists require source state and saved capture; no matches is valid', async () => {
  const rows = await auditSpotifyCharts(r2(), now);
  assert.equal(rows.length, 21);
  assert(rows.every(row => row.status === 'OK'));
  assert(rows.every(row => row.detail.includes('history=in progress')));
});
test('history writes/check timestamps cannot freshen old source observations', async () => {
  const rows = await auditSpotifyCharts(r2(value => value.observed_at ? { ...value, observed_at: now - 49 * 3600000, updated_at: now, checked_at: now } : value), now);
  assert(rows.every(row => row.status === 'STALE'));
});
test('failed latest, failed history, invalid identity, stale chart and absent capture fail closed', async () => {
  for (const change of [
    value => ({ ...value, latest_status: 'error', error_code: '401' }),
    value => ({ ...value, history_status: 'error' }),
    value => ({ ...value, chart_id: 'wrong' }),
    value => ({ ...value, latest_chart_date: '2026-09-01' }),
    value => ({ ...value, periods: [] }),
  ]) assert((await auditSpotifyCharts(r2(change), now)).every(row => row.status !== 'OK'));
  const rows = await auditSpotifyCharts({ get: async () => { throw Error('Bearer SECRET'); } }, now);
  assert(rows.every(row => row.status === 'UNKNOWN'));
  assert(!JSON.stringify(rows).includes('SECRET'));
});
function db({ missing = false, failed = false } = {}) {
  return { prepare(sql) {
    assert.match(sql, /snapshot_date>=\?/);
    return { bind(...args) { return {
      all: async () => ({ results: [{ snapshot_date: '2026-10-18', status: failed ? 'error' : 'complete', completed_at: now, tracks_collected: 123, albums_queued: 4, albums_completed: 4 }] }),
      first: async () => missing && args[1] === SPOTIFY_MONTHLY_LISTENER_ARTISTS[0].artist_key ? null : { snapshot_date: '2026-10-18', monthly_listeners: 0, tracks: 123, collected_at: now },
    }; } };
  } };
}
test('bounded D1 checks require every artist, preserve zero values and catch collection errors', async () => {
  const rows = await auditSpotifyD1(db(), now);
  assert.equal(rows.length, 4 + SPOTIFY_MONTHLY_LISTENER_ARTISTS.length);
  assert(rows.every(row => row.status === 'OK'));
  assert.equal((await auditSpotifyD1(db({ missing: true }), now))[1].status, 'UNKNOWN');
  assert.equal((await auditSpotifyD1(db({ failed: true }), now))[0].status, 'FAIL');
});

test('carried-forward rows cannot satisfy per-artist source evidence', async () => {
  const statements = [];
  const empty = { prepare(sql) { statements.push(sql); return { bind() { return {
    all: async () => ({ results: [] }), first: async () => null,
  }; } }; } };
  const rows = await auditSpotifyD1(empty, now);
  assert(rows.every(row => row.status === 'UNKNOWN'));
  const actualQueries = statements.filter(sql => sql.includes('sh_spotify_track_targets'));
  assert.equal(actualQueries.length, 3);
  assert(actualQueries.every(sql => sql.includes('COALESCE(d.is_carried_forward,0)=0')));
  assert(actualQueries.every(sql => sql.includes('target.artist_key=?')));
});
