# Spotify playcount collector

This Worker collects one daily Spotify cumulative playcount snapshot for tracks
by Nogizaka46, Sakurazaka46, and Hinatazaka46.

## Runtime

- Worker: `sh-spotify-playcount-collector`
- Schedule: 21:05 UTC / 06:05 JST
- Catalog: Spotify Web API artist albums (`album`, `single`, `appears_on`)
- Playcount: Spotify public album page `initialState`
- Storage: `OTHER_DB` (`stationhead-other`)
- Fan-out: `stationhead-spotify-playcount` Queue, one message per album

Catalog discovery and playcount retrieval are intentionally separate. The
catalog path uses the supported Web API. Exact playcount is not exposed by the
public Web API, so the collector reads the base64-encoded `initialState` data
that Spotify currently embeds in its public album pages. This avoids carrying
or synthesizing Web Player access/client tokens in the Worker.

The album-page structure is not a supported Spotify developer API and can
change without notice. An album that yields no target tracks is treated as a
collection failure, retried by Queue, and recorded in the collection-run tables
instead of being accepted as an empty successful snapshot.

## Required secrets

Configure these Worker secrets before enabling the scheduled collector:

```sh
npx wrangler secret put SPOTIFY_CLIENT_ID --config wrangler.spotify-playcount.jsonc
npx wrangler secret put SPOTIFY_CLIENT_SECRET --config wrangler.spotify-playcount.jsonc
```

The client ID and secret are only used for catalog discovery through Spotify's
Client Credentials flow. They are not used for playcount collection and are not
stored in D1.

## Compatibility boundary

If Spotify changes its public album-page bootstrap format, update
`decodeSpotifyInitialState()`, `albumFromInitialState()`, or
`normalizeAlbumTracks()` in `worker/src/spotify-playcount-collector.js`.

`SPOTIFY_PUBLIC_ALBUM_BASE` is available as an optional diagnostic override.
Do not use it to proxy production data through an untrusted service.

## Data semantics

`sh_spotify_playcount_daily.delta` is the difference between two cumulative
Spotify playcount observations. It is `NULL` for a track's first observation
and when a later observed cumulative count is lower than the preceding value.

Daily rows are insert-once by `(snapshot_date, track_id)`. Queue retries and
reruns therefore do not replace the first observation for a JST date.
