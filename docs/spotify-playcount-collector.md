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
rewrite unchanged D1 rows. Queue retries reuse the catalog. Track metadata is
also inserted only when a track is first seen; the per-attempt candidate table
contains the cumulative counters needed for update detection and finalization.

## Update detection and hourly retry

At 05:00 JST the Worker starts the day's first collection attempt. Album results
are written to `sh_spotify_playcount_candidates`; they are not immediately
written to the daily history.

After every album in the attempt finishes, the candidate snapshot is compared
with the previous JST day's finalized snapshot. The day is considered updated
only when at least one track that already existed in the previous snapshot has a
larger cumulative playcount. A newly discovered track by itself does not mark
the catalog as updated.

If no existing track has advanced, the run is marked `stale`. The hourly Cron
starts a fresh attempt at 06:00, then 07:00, and so on until an updated snapshot
is observed. Once the snapshot is finalized, later hourly Cron invocations skip
that date.

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

A candidate snapshot must also contain every track present in the previous day's
snapshot. If tracks are missing, the attempt is marked `incomplete` and retried
on the next hour rather than finalizing partial data. `incomplete` and actual
collection errors are not converted to carried-forward days; rollover applies
only to a successfully collected but unchanged (`stale`) snapshot.

Each attempt has a new `run_token`. Queue messages from superseded attempts are
acknowledged and ignored. Candidate writes also verify the active run token in
D1, preventing a late Queue delivery from contaminating a newer hourly attempt.

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
covered by tests. A missing session, GraphQL error, empty discography, or album
without target playcount rows fails the attempt instead of silently finalizing
partial data. Structured Worker logs include collection stage, snapshot date,
and album ID where relevant, but never the anonymous access token.

`SPOTIFY_EMBED_ARTIST_BASE` and `SPOTIFY_PATHFINDER_URL` are optional diagnostic
overrides. Production normally uses Spotify directly.

## Data semantics

`sh_spotify_playcount_daily.delta` is the difference between finalized cumulative
playcount observations. It is `NULL` for a track's first observation, when a
later cumulative value decreases, and on a carried-forward no-update date.

`sh_spotify_playcount_daily.is_carried_forward=1` means Spotify did not publish a
new cumulative value for that JST date before the next 05:00 boundary. That row
exists to keep the calendar continuous and must not be interpreted as evidence
of zero actual streams.

Only the first successful post-update snapshot is finalized for a date. Earlier
05:00/06:00/etc. stale candidates are discarded when the next hourly attempt
starts. Once finalized or carried forward, that date is not recollected by later
hourly Cron invocations.
