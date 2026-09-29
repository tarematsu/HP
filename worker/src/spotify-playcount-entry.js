import {
  jstDateKey,
  jstHour,
  processSpotifyPlaycountBatch,
  runSpotifyPlaycountScheduled,
} from './spotify-playcount-collector.js';
import { spotifyArtistDailyRefreshStatements } from './spotify-playcount-summary.js';
import { requestSpotifyReadModelRefresh } from './spotify-pages-read-model.js';
import { configureStationheadTrackResolver } from './spotify-stationhead-identity.js';

async function carryForwardExpiredStaleDays(db, scheduledTime) {
  if (!db?.prepare || jstHour(scheduledTime) !== 5) return 0;

  const today = jstDateKey(scheduledTime);
  const result = await db.prepare(`SELECT snapshot_date
    FROM sh_spotify_collection_runs
    WHERE snapshot_date < ? AND status='stale'
    ORDER BY snapshot_date`).bind(today).all();
  const staleDates = Array.isArray(result?.results) ? result.results : [];
  let carried = 0;

  for (const row of staleDates) {
    const snapshotDate = String(row.snapshot_date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) continue;

    const baseline = await db.prepare(`SELECT MAX(snapshot_date) AS snapshot_date
      FROM sh_spotify_playcount_daily
      WHERE snapshot_date < ?`).bind(snapshotDate).first();
    const baselineDate = String(baseline?.snapshot_date || '');
    if (!baselineDate) continue;

    const now = Date.now();
    await db.prepare(`INSERT INTO sh_spotify_playcount_daily (
        snapshot_date,track_id,playcount,delta,collected_at,is_carried_forward
      )
      SELECT ?,track_id,playcount,NULL,?,1
      FROM sh_spotify_playcount_daily
      WHERE snapshot_date=?
      ON CONFLICT(snapshot_date,track_id) DO UPDATE SET
        playcount=excluded.playcount,
        delta=NULL,
        collected_at=excluded.collected_at,
        is_carried_forward=1`)
      .bind(snapshotDate, now, baselineDate)
      .run();

    for (const statement of spotifyArtistDailyRefreshStatements(db, snapshotDate, now)) {
      await statement.run();
    }

    await db.prepare(`UPDATE sh_spotify_collection_runs
      SET status='complete',
          tracks_collected=(
            SELECT COUNT(*) FROM sh_spotify_playcount_daily WHERE snapshot_date=?
          ),
          completed_at=?,updated_at=?,
          last_error=NULL
      WHERE snapshot_date=? AND status='stale'`)
      .bind(snapshotDate, now, now, snapshotDate)
      .run();

    await db.batch([
      db.prepare(`DELETE FROM sh_spotify_playcount_candidates WHERE snapshot_date=?`).bind(snapshotDate),
      db.prepare(`DELETE FROM sh_spotify_collection_album_runs WHERE snapshot_date=?`).bind(snapshotDate),
    ]);
    carried += 1;
  }

  return carried;
}

export default {
  async scheduled(controller, env, ctx) {
    const rawScheduledTime = Number(controller?.scheduledTime);
    const scheduledTime = Number.isFinite(rawScheduledTime) ? rawScheduledTime : Date.now();
    const work = (async () => {
      const carried = await carryForwardExpiredStaleDays(env?.OTHER_DB, scheduledTime);
      if (carried > 0) {
        await requestSpotifyReadModelRefresh(env, 'playcount-carry-forward', { carried_days: carried });
      }
      return runSpotifyPlaycountScheduled(controller, env);
    })();
    if (ctx?.waitUntil) {
      ctx.waitUntil(work);
      return;
    }
    await work;
  },

  async queue(batch, env, ctx) {
    configureStationheadTrackResolver(env?.MINUTE_DB);
    return processSpotifyPlaycountBatch(batch, env, { ctx });
  },

  async fetch() {
    return new Response('Not found', { status: 404 });
  },
};
