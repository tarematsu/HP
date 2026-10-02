import {
  jstDateKey,
  jstHour,
  processSpotifyPlaycountBatch,
  runSpotifyPlaycountScheduled,
} from './spotify-playcount-collector.js';
import { spotifyArtistDailyRefreshStatements } from './spotify-playcount-summary.js';
import { requestSpotifyReadModelRefresh } from './spotify-pages-read-model.js';
import { configureStationheadTrackResolver } from './spotify-stationhead-identity.js';
import { probeStaleSpotifyUpdate } from './spotify-stale-update-probe.js';
import {
  isSpotifyFastRetryWindow,
  isSpotifyHourlyBoundary,
} from './spotify-playcount-timing.js';

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

async function runScheduledCollection(controller, env, scheduledTime) {
  const hourlyBoundary = isSpotifyHourlyBoundary(scheduledTime);
  const fastRetryWindow = isSpotifyFastRetryWindow(scheduledTime);

  // Every scheduled hourly check first probes unresolved stale data with at most
  // a few representative tracks. The 00:00-04:50 ten-minute checks use the same
  // path. A full recollection starts only after Spotify publishes a changed value.
  if (hourlyBoundary || fastRetryWindow) {
    const probe = await probeStaleSpotifyUpdate(env, scheduledTime);
    if (probe.stale) {
      console.log(JSON.stringify({
        event: 'spotify_stale_source_probe',
        scheduled_at: scheduledTime,
        ...probe,
      }));
      if (probe.changed) return runSpotifyPlaycountScheduled(controller, env);

      // Missing probe candidates indicate a broken/legacy stale state rather than
      // a merely delayed Spotify update. Keep the hourly repair fallback for that
      // exceptional case, while source errors and unchanged values stay lightweight.
      if (probe.reason === 'no-probe-tracks' && hourlyBoundary) {
        return runSpotifyPlaycountScheduled(controller, env);
      }
      return {
        skipped: true,
        reason: probe.reason,
        snapshot_date: probe.snapshot_date || null,
        checked_tracks: probe.checked_tracks || 0,
      };
    }

    // Ten-minute ticks exist only to watch an unresolved stale run. Other states
    // retain the normal hourly cadence.
    if (fastRetryWindow && !hourlyBoundary) {
      return { skipped: true, reason: 'fast-retry-no-stale-day' };
    }
  }

  return runSpotifyPlaycountScheduled(controller, env);
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
      return runScheduledCollection(controller, env, scheduledTime);
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
