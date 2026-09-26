# Spotify playcount collector

This Worker collects one daily Spotify cumulative playcount snapshot for tracks
by Nogizaka46, Sakurazaka46, and Hinatazaka46.

## Runtime

- Worker: `sh-spotify-playcount-collector`
- Schedule: 21:05 UTC / 06:05 JST
- Catalog: Spotify Web API artist albums (`album`, `single`, `appears_on`)
- Playcount: Spotify Web Player internal `queryAlbumTracks`
- Storage: `OTHER_DB` (`stationhead-other`)
- Fan-out: `stationhead-spotify-playcount` Queue, one message per album

Catalog discovery and playcount retrieval are intentionally separate. The
catalog path uses the supported Web API. Playcount is not exposed by the public
Web API, so the collector uses the Web Player's internal persisted GraphQL
query. That endpoint, anonymous-token bootstrap, response shape, and persisted
query hash are not public Spotify APIs and may change without notice.

## Required secrets

Configure these Worker secrets before enabling the scheduled collector:

```sh
npx wrangler secret put SPOTIFY_CLIENT_ID --config wrangler.spotify-playcount.jsonc
npx wrangler secret put SPOTIFY_CLIENT_SECRET --config wrangler.spotify-playcount.jsonc
```

The client ID and secret are only used for catalog discovery through Spotify's
Client Credentials flow. They are not stored in D1.

## Web Player compatibility boundary

The following bindings are intentionally configurable so Web Player changes do
not require a data migration:

- `SPOTIFY_ALBUM_TRACKS_QUERY_HASH`
- `SPOTIFY_PARTNER_ENDPOINT`
- `SPOTIFY_WEB_TOKEN_URL`
- `SPOTIFY_WEB_ACCESS_TOKEN` (temporary diagnostic override)
- `SPOTIFY_WEB_CLIENT_TOKEN` (optional when the partner endpoint requires it)

Do not commit token values. Use Wrangler secrets for token overrides.

If the internal response schema changes, update `normalizeAlbumTracks()` in
`worker/src/spotify-playcount-collector.js`. Both the older `data.album` and
newer `data.albumUnion` shapes are accepted.

## Data semantics

`sh_spotify_playcount_daily.delta` is the difference between two cumulative
Spotify playcount observations. It is `NULL` for a track's first observation
and when a later observed cumulative count is lower than the preceding value.

Daily rows are insert-once by `(snapshot_date, track_id)`. Queue retries and
reruns therefore do not replace the first observation for a JST date.
