# Spotify playcount collector

This Worker collects one daily Spotify cumulative playcount snapshot for tracks
by Nogizaka46, Sakurazaka46, and Hinatazaka46.

## Runtime

- Worker: `sh-spotify-playcount-collector`
- Cron: every hour at minute 00
- First daily check: 05:00 JST
- Retry: every following hour until Spotify playcounts have advanced from the previous day
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
that date. If a date is still unresolved after midnight, hourly retries continue
for that older date; a new date is not started ahead of it.

A candidate snapshot must also contain every track present in the previous day's
snapshot. If tracks are missing, the attempt is marked `incomplete` and retried
on the next hour rather than finalizing partial data.

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

`sh_spotify_playcount_daily.delta` is the difference between the finalized
cumulative playcount for a JST date and the previous JST date. It is `NULL` for
a track's first finalized observation and when a later observed cumulative count
is lower than the preceding value.

Only the first successful post-update snapshot is finalized for a date. Earlier
05:00/06:00/etc. stale candidates are discarded when the next hourly attempt
starts.
