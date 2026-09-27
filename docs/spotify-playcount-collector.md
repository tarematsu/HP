# Spotify playcount collector

This Worker collects one daily Spotify cumulative playcount snapshot for tracks
by Nogizaka46, Sakurazaka46, and Hinatazaka46.

## Runtime

- Worker: `sh-spotify-playcount-collector`
- Cron: every hour at minute 00
- First daily check: 05:00 JST
- Retry: 06:00, 07:00, 08:00, ... until Spotify playcounts have advanced from the previous day
- Catalog: Spotify public artist discography pages
- Track/playcount source: Spotify public album-page `initialState`
- Storage: `OTHER_DB` (`stationhead-other`)
- Fan-out: `stationhead-spotify-playcount` Queue, one message per album

The collector does not use the Spotify Web API. Each target artist is identified
by its stable Spotify artist ID. On the first attempt for a snapshot date, the
Worker fetches `open.spotify.com/artist/{artist_id}/discography/all`, extracts
album IDs from the rendered page and its embedded `initialState`, and refreshes
the known release catalog in D1. Releases already discovered are retained even
when a later public discography response omits them.

Each active album is then fetched through its public Spotify album page. Track
IDs, names, cumulative playcounts, durations, and artist relationships are read
from the page's base64-encoded `initialState` data. No Spotify login, developer
application, client ID, client secret, OAuth access token, client token, or
persisted GraphQL query is required.

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
acknowledged and ignored, preventing a late Queue delivery from contaminating a
newer hourly attempt.

## Compatibility boundary

Spotify's public page bootstrap format is not a supported developer API and can
change without notice. Relevant parsing is isolated in:

- `albumIdsFromDiscographyHtml()` for release discovery
- `decodeSpotifyInitialState()` for page bootstrap decoding
- `albumFromInitialState()` for album selection
- `normalizeAlbumTracks()` for track/playcount normalization

If a discography yields no releases, the run fails instead of replacing the
known catalog with an empty set. If an album credited to a target artist yields
no target playcount tracks, that Queue item is retried and the failure is
recorded. Album links confirmed not to be credited to the target artist are
deactivated instead of being retried forever.

`SPOTIFY_PUBLIC_ARTIST_BASE` and `SPOTIFY_PUBLIC_ALBUM_BASE` are optional
diagnostic overrides. Production should normally use Spotify directly.

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
