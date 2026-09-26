# Spotify playcount collector

This Worker collects one daily Spotify cumulative playcount snapshot for tracks
by Nogizaka46, Sakurazaka46, and Hinatazaka46.

## Runtime

- Worker: `sh-spotify-playcount-collector`
- Schedule: 21:05 UTC / 06:05 JST
- Catalog: Spotify public artist discography pages
- Track/playcount source: Spotify public album-page `initialState`
- Storage: `OTHER_DB` (`stationhead-other`)
- Fan-out: `stationhead-spotify-playcount` Queue, one message per album

The collector does not use Spotify Web API credentials. Each target artist is
identified by its stable Spotify artist ID. Once per day, the Worker fetches
`open.spotify.com/artist/{artist_id}/discography/all`, extracts album IDs from
the rendered page and its embedded `initialState`, and refreshes the active
release catalog in D1.

Each active album is then fetched through its public Spotify album page. Track
IDs, names, cumulative playcounts, durations, and artist relationships are read
from the page's base64-encoded `initialState` data. No Spotify login, OAuth
client, access token, client token, or persisted GraphQL query is required.

## Compatibility boundary

Spotify's public page bootstrap format is not a supported developer API and can
change without notice. Relevant parsing is isolated in:

- `albumIdsFromDiscographyHtml()` for release discovery
- `decodeSpotifyInitialState()` for page bootstrap decoding
- `albumFromInitialState()` for album selection
- `normalizeAlbumTracks()` for track/playcount normalization

If a discography yields no releases, the daily run fails instead of replacing
the known catalog with an empty set. If an album credited to a target artist
yields no target playcount tracks, that Queue item is retried and the failure is
recorded. Album links that turn out not to be credited to the target artist are
deactivated instead of being retried forever.

`SPOTIFY_PUBLIC_ARTIST_BASE` and `SPOTIFY_PUBLIC_ALBUM_BASE` are optional
diagnostic overrides. Production should normally use Spotify directly.

## Data semantics

`sh_spotify_playcount_daily.delta` is the difference between two cumulative
Spotify playcount observations. It is `NULL` for a track's first observation
and when a later observed cumulative count is lower than the preceding value.

Daily rows are insert-once by `(snapshot_date, track_id)`. Queue retries and
reruns therefore do not replace the first observation for a JST date.
