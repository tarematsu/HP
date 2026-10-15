# Spotify playcount collector

This Worker collects one daily Spotify cumulative playcount snapshot for tracks
by Nogizaka46, Sakurazaka46, and Hinatazaka46.

## Runtime

- Worker: `sh-spotify-playcount-collector`
- Cron: every hour at minute 00
- First daily check: 05:00 JST
- Retry: 06:00, 07:00, 08:00, ... until Spotify playcounts have advanced from the previous day
- Session bootstrap: public Spotify artist embed page
- Catalog: Spotify web-player Pathfinder `queryArtistDiscographyAll`
- Track/playcount source: Spotify web-player Pathfinder `queryAlbumTracks`
- Storage: `OTHER_DB` (`stationhead-other`)
- Fan-out: `stationhead-spotify-playcount` Queue, one message per album

The collector does not require a Spotify developer application, client secret,
stored account credentials, or user OAuth. It opens the public
`open.spotify.com/embed/artist/{artist_id}` page and reads the ephemeral anonymous
web-player session from its `__NEXT_DATA__` bootstrap. The anonymous access token
is held only in memory for the current invocation and is never persisted or
logged.

Spotify no longer includes the release catalog or cumulative playcounts in the
ordinary `open.spotify.com` server-rendered HTML used by the original collector.
The collector therefore follows the current public web player's own anonymous
Pathfinder requests. `queryArtistDiscographyAll` discovers all release IDs for
each target artist and `queryAlbumTracks` returns the album track rows including
cumulative playcounts. The collector does not call `api.spotify.com/v1`.

The first attempt for a snapshot date refreshes the release catalog. Known active
release-target pairs are left untouched so the daily catalog refresh does not
rewrite unchanged D1 rows. Normal stale retries reuse the catalog; retries after
collection errors or incomplete snapshots refresh it again so newly corrected
catalog data can self-heal a failed attempt. Track metadata is inserted only when
a track is first seen; the per-attempt candidate table contains the cumulative
counters needed for update detection and finalization.

## Update detection and hourly retry

At 05:00 JST the Worker starts the day's first collection attempt. Album results
are written to `sh_spotify_playcount_candidates`; they are not immediately
written to the daily history.

After every album in the attempt finishes, the candidate snapshot is compared
with the previous JST day's finalized snapshot. The day is considered updated
only when at least one track that already existed in the previous snapshot has a
larger cumulative playcount. A newly discovered track by itself does not mark
the catalog as updated.

A candidate must contain every track from the previous finalized day and no
existing track may have a lower cumulative count. Missing tracks or backwards
counters mark the attempt `incomplete` and cause an hourly retry instead of
publishing a partial or non-monotonic snapshot. When the same Spotify track ID is
seen through multiple releases in one attempt, staging keeps the highest observed
cumulative value so a stale duplicate album response cannot overwrite a fresher
one.

If no existing track has advanced, the run is marked `stale`. The hourly Cron
starts a fresh attempt at 06:00, then 07:00, and so on until an updated snapshot
is observed. Once the snapshot is finalized, later hourly Cron invocations skip
that date.

Finalization is claimed by a single Queue delivery using the run status
`finalizing`. Late or duplicate Queue deliveries are accepted only while the run
is `catalog` or `queued`; after a run becomes `stale`, `incomplete`, `finalizing`,
or `complete`, superseded messages cannot mutate candidates or album progress.
After a successful finalization, per-attempt candidate and album-progress rows are
deleted; `sh_spotify_collection_runs` retains the summary state.

## Whole-day no-update rollover

Spotify can occasionally leave the cumulative counters unchanged for an entire
JST day. The collector must not keep that old date open forever because doing so
would shift later updates onto the wrong date.

At the next 05:00 JST, any prior date that is still `stale` is closed as a
no-published-update day. The most recent finalized cumulative values are copied
forward into `sh_spotify_playcount_daily` for that date with
`is_carried_forward=1` and `delta=NULL`. The stale candidate rows are discarded,
the run is marked complete, and collection for the new JST date may start
immediately.

This preserves the calendar sequence without pretending that Spotify published a
new daily count. When Spotify later advances the counters, the observed increase
is compared against the carried-forward cumulative baseline. The increase may
therefore cover more than one calendar day; downstream reporting should inspect
`is_carried_forward` on preceding dates rather than treating the later delta as
a precisely isolated one-day total.

`incomplete` and actual collection errors are not converted to carried-forward
days; rollover applies only to a successfully collected but unchanged (`stale`)
snapshot.

Each attempt has a new `run_token`. Queue messages from superseded attempts are
acknowledged and ignored. Candidate and album-progress writes also verify the
active run token and active run status in D1, preventing a late Queue delivery
from contaminating a newer hourly attempt.

## Compatibility boundary

Pathfinder is an internal interface used by Spotify's web player rather than a
stable public developer API. Spotify can change the persisted operations or
anonymous-session bootstrap without notice. The compatibility boundary is kept
in `spotify-playcount-source.js`:

- `parseSpotifyEmbedSession()` reads the anonymous session from the public embed
  page.
- `releasesFromArtistDiscography()` normalizes `queryArtistDiscographyAll`.
- `normalizeAlbumTracks()` normalizes `queryAlbumTracks` and filters tracks to
  the target groups.

The persisted operation hashes are isolated next to those source functions and
covered by tests. A missing session, GraphQL error, empty discography, missing
track counters, incomplete artist credits, or non-monotonic cumulative snapshot
fails the attempt instead of silently finalizing partial data. A legacy release
target is deactivated only when all returned album tracks expose artist credits
and none of those credits matches the target artist, avoiding destructive cleanup
when Spotify changes or omits response fields. Structured Worker logs include
collection stage, snapshot date, and album ID where relevant, but never the
anonymous access token.

`SPOTIFY_EMBED_ARTIST_BASE` and `SPOTIFY_PATHFINDER_URL` are optional diagnostic
overrides. Production normally uses Spotify directly.

## Data semantics

`sh_spotify_playcount_daily.delta` is the difference between finalized cumulative
playcount observations. It is `NULL` for a track's first observation and on a
carried-forward no-update date. A lower cumulative count is not finalized; the
attempt is retried as `incomplete`.

`sh_spotify_playcount_daily.is_carried_forward=1` means Spotify did not publish a
new cumulative value for that JST date before the next 05:00 boundary. That row
exists to keep the calendar continuous and must not be interpreted as evidence
of zero actual streams.

Only the first successful post-update snapshot is finalized for a date. Earlier
05:00/06:00/etc. stale candidates are discarded when the next hourly attempt
starts. Once finalized or carried forward, that date is not recollected by later
hourly Cron invocations.

## Spotify Japan Charts

The streaming navigation separates **Spotify 再生数** (global cumulative playcounts)
from **Spotify チャート** (monthly listeners and Japan chart ranks). The latter has
monthly listeners, Top Artists, Top Songs, Top Albums, and Viral panels. Each panel
uses the common music-service shell, graph, filters and history table. Artists,
songs and viral charts have daily/weekly periods; albums have weekly periods.
The four tracked artist identities reuse `SPOTIFY_MONTHLY_LISTENER_ARTISTS`,
including 坂道選抜. Collaborations match every credited tracked artist by Spotify ID.

`spotify-japan-charts.js` handles collection in the existing Spotify Queue. The
normal artist-chart schedule enqueues the seven series. Latest captures start or
resume backward collection, one period per invocation with a 30-second delayed
continuation. Spotify's `displayChart.chartMetadata.dimensions.earliestDate`
bounds backfill; 2017-01-01 is a conservative fallback when it is absent. If a Viral latest endpoint returns 404, a bounded, one-time set of historical
dates is probed before declaring it unavailable. An accessible archive seeds the
same backfill; failed probes are recorded without inventing ranking data. An
unavailable latest series is reported separately, and a historical HTTP 404 is
never recorded as an empty/absent ranking. 429/5xx do not advance the failed cursor.
A private, short-lived access-token cache avoids refreshing OAuth or rewriting
Worker secrets for every backfill delivery. It stores no refresh token, is excluded
from public model keys, and is invalidated on HTTP 401.
Index publication is a separate, durable Queue message coalesced at 30-second
intervals. Each source invocation writes its year shard and checkpoint at most
once to respect R2 same-key write limits.
Every successful period is checkpointed and retried idempotently. Later latest
captures repair gaps since the previous successful latest. The Queue uses one
consumer at a time to serialize state, year-shard and refresh-token updates.

Matched entities, ranking metadata and Top Songs stream counts are stored as
prebuilt year-partitioned responses (`spotify-charts:<chart-id>:<year>`) in the
existing Pages response bucket. `spotify-charts` lists per-series availability,
years and backfill progress; private checkpoints live outside public model keys.
No new D1 tables or full-history D1 scans are needed. Pages streams the existing
Worker read models; it performs no upstream chart collection or history assembly.
The browser loads only the selected chart's year shards and uses the same selected
range and artist filter for graph and table. Captured absence is out of chart;
uncollected dates break lines. Monthly listeners keep their existing retained
snapshots: Spotify Charts does not provide historic monthly-listener counts.

`Start Spotify Japan chart history` runs after the normal production deployment
on relevant main changes, or manually, to enqueue the initial work using the
existing Cloudflare Actions credential. It does not require another cookie or
expose Spotify tokens in Actions. A successful start means work was enqueued;
completion and source availability are visible in `/api/spotify-charts` and the UI.
