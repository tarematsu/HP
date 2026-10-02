# Kugou Music collection research

Research date: 2026-10-02 (JST)

## Scope

This note separates data that the current collector can obtain from simple public web surfaces from data that appears available only through Kugou client-style signed requests. The production collector must not bypass access controls or fabricate unavailable metrics.

Current target artists and provider IDs:

| canonical artist | Kugou author ID | current profile surface |
| --- | ---: | --- |
| `sakurazaka46` | `5317322` | `https://pcretry.kugou.com/yueku/v8/singer/home/5317322-0-6-r.html` |
| `hinatazaka46` | `798934` | `https://pcretry.kugou.com/yueku/v8/singer/home/798934-0-6-r.html` |
| `nogizaka46` | `84243` | `https://pcretry.kugou.com/yueku/v8/singer/home/84243-0-6-n.html` |

The current production collector already verifies the profile breadcrumb and parses the page's embedded `homeSongs` array. This is the safest low-cost source and needs one request per artist per collection pass.

## Data surface map

### 1. Public artist page: safe/current production source

The artist page provides a provider-owned artist identity plus an ordered set of tracks. The embedded objects can carry more provider-native metadata than the collector currently persists.

Useful fields seen across Kugou web/search payloads:

- `album_audio_id` / `MixSongID`: stable song/release-track identity and the key used by several richer Kugou endpoints
- `audio_id`: audio identity
- `hash` / `FileHash`: content/version identity
- `songname` / `SongName`
- `singername` and sometimes `authors[]`
- `album_id`
- `album_name`
- `duration`
- `mvhash`
- `ownercount` / `OwnerCount`
- `isnew`
- `privilege`, `pay_type`, quality/availability flags

The existing parser prefers `album_audio_id`, then audio ID, then the hash fallback. That remains appropriate because `album_audio_id` is also the join key for richer song-level APIs.

**Caution:** the artist page ordering is provider page order, not necessarily a formally documented chart. Persist it as `artist_page_order`, not as an explicit Kugou chart rank.

### 2. Public search endpoint: useful discovery/fallback

The repo already has a parser for the public search family:

`https://msearchcdn.kugou.com/api/v3/search/song?plat=0&version=9108&...`

Historically this payload exposes `album_audio_id`, `audio_id`, `album_id`, `hash`, `mvhash`, `duration`, `ownercount`, album/title/artist metadata and availability fields. It is useful for:

- exact-artist discovery/fallback
- resolving provider IDs for newly released tracks
- filling album metadata when the artist page is sparse
- detecting alternate versions without downloading audio

It should not be the primary daily catalog source when the fixed artist page is healthy because the artist page is cheaper and has a stronger ownership anchor.

### 3. Artist tracks and albums: richer/full-catalog candidate, signed client surface

A current reverse-engineered Kugou client implementation shows dedicated artist endpoints:

- tracks: `POST /kmr/v1/audio_group/author` on `https://openapi.kugou.com`, with `author_id`, `page`, `pagesize`, and `sort` (`hot`/`new`)
- albums: `POST /kmr/v1/author/albums`, with `author_id`, paging and `sort`

Source references:

- `https://github.com/MakcRe/KuGouMusicApi/blob/main/module/artist_audios.js`
- `https://github.com/MakcRe/KuGouMusicApi/blob/main/module/artist_albums.js`

Both are issued as Kugou Android-style signed requests by that project. Therefore they are **research candidates, not enabled production fetches**. They could solve the main limitation of `homeSongs`: obtaining the full back catalog in explicit hot/new order.

Recommended use if a stable authorized/simple request path is later confirmed:

- refresh `new` daily only for recently active artists
- refresh complete albums weekly or on release detection
- refresh `hot` at most daily if its order is valuable
- avoid rescanning every historical album every day

### 4. Track favourites / collection count: high-value metric, verification risk

Kugou exposes a track collection/favourite-count concept. A current reverse-engineered client maps it to:

`GET /count/v1/audio/mget_collect?mixsongids=...`

Source: `https://github.com/MakcRe/KuGouMusicApi/blob/main/module/favorite_count.js`

The same project documents it as not requiring login and supports batching multiple `mixsongids`. However a 2025 upstream issue recorded error `20028` (`本次操作需进行验证`) for this endpoint, so "no login" does not mean "plain unsigned fetch" or "no bot/device verification".

Source: `https://github.com/MakcRe/KuGouMusicApi/issues/79`

The ordinary search payload's `ownercount` may provide the same or a closely related collection signal without the extra endpoint, but this equivalence should be validated before storing it as a canonical metric.

Recommendation:

- retain `ownercount` in parser output for diagnostics
- do **not** rename it to `likes` or `favorites` in D1 until equivalence is verified
- if the batch count endpoint becomes reliable, add a dedicated `favorites`/`collections` metric rather than overloading `likes`

### 5. Comments: count is potentially collectable without login, but request is signed/routed

A current reverse-engineered implementation obtains song comment counts using:

- route parameter `r=comments/getcommentsnum`
- song `hash` (or comment child ID)
- comment pool code `fc4be23b4e972707f36b8a828a93ba8a`
- router header `x-router: sum.comment.service.kugou.com`
- Kugou web signing

Source: `https://github.com/MakcRe/KuGouMusicApi/blob/main/module/comment_count.js`

The API project's documentation also exposes song comment list/count operations as usable without login, while posting/deleting requires login.

Recommendation:

- comment **count** is valuable and fits `regional_music_track_daily.comments`
- do not collect comment bodies unless there is a concrete analysis requirement
- first validate that Cloudflare Worker requests can reproduce the public count without device challenges
- if enabled, batch/rotate over the current top/new tracks rather than every historical track daily

### 6. Song "report card" / ranking information: interesting but not yet production-safe

Current client research exposes:

`GET /grow/v1/song_ranking/play_page/ranking_info?album_audio_id=...`

Source: `https://github.com/MakcRe/KuGouMusicApi/blob/main/module/song_ranking.js`

The detailed ranking view is documented as login-required; the summary endpoint is the more interesting research target. Its semantics and returned fields must be captured from a current response before mapping anything into `plays`, `listeners` or `popularity_rank`.

Do not infer a play count from an opaque score or rank label.

### 7. Kugou chart/rank surfaces

Kugou has native rank-list APIs. Older public v3 documentation exposed rank metadata including:

- rank ID/name
- methodology/intro text
- update frequency
- issue/volume
- ordered songs

Examples historically included the Kugou rising chart (ordered by increase in search/play activity) and a daily total-play chart. Historical documentation also shows external charts such as Japan Oricon and Korea Melon being surfaced inside Kugou.

Important distinction:

- a **Kugou-native** chart can be stored as a Kugou chart observation
- a republished **Oricon/Melon** chart must not be presented as Kugou streaming popularity

The current reverse-engineered client now calls `GET /ocean/v6/rank/list` using an Android-style signed request (`https://github.com/MakcRe/KuGouMusicApi/blob/main/module/rank_list.js`). Therefore rank collection needs a current request/response probe before production enablement.

### 8. Play count

No stable, verified, simple public endpoint was found that returns a cumulative per-track Kugou play count suitable for the current production collector.

There are rank surfaces whose methodology refers to playback/search activity, and the song report-card endpoint may expose related performance information, but neither should be converted to `track_plays` until the current response semantics are verified.

**Current conclusion: do not claim a Kugou cumulative play count.**

## What can be collected today with high confidence

| signal | confidence | auth/signing | production recommendation |
| --- | --- | --- | --- |
| artist ID / profile presence | high | none on current page | collect |
| ordered artist-page tracks | high | none on current page | collect |
| title / album name | high | none | collect |
| `album_audio_id`, audio ID, hash, album ID, duration, MV hash | high when present | none on search/page payload | retain in parser/probe; persist selectively |
| artist-page order | high as page position | none | collect as `artist_page_order` |
| `ownercount` | medium semantic confidence | none when embedded | retain raw; do not relabel yet |
| full artist `hot` / `new` catalog | high capability confidence | signed client request | research only |
| album catalog | high capability confidence | signed client request | research only |
| favourite/collection count | medium runtime confidence | signed/device-style request; verification possible | research only |
| comment count | medium-high capability confidence | signed/routed web request | probe before enabling |
| song report-card ranking | medium | signed client request | research only |
| Kugou native charts | high capability confidence | current API signed | probe before enabling |
| cumulative track plays | low | unresolved | do not claim |

## Low-cost collection plan

The production design should optimize for the three Sakamichi groups rather than crawl Kugou globally.

1. **Daily baseline:** 3 artist-page requests (one per group). Persist catalog identity/order only.
2. **New-release discovery:** use the current page first; use search only when a new item cannot be resolved or the page is incomplete.
3. **Weekly deep catalog:** only after a stable authorized full-catalog request is proven; enumerate albums/tracks and store changes.
4. **Metrics rotation:** if comment/favourite counts become reliable, query only new/current top tracks daily and rotate the historical catalog over multiple days.
5. **Charts:** fetch only explicitly selected Kugou-native charts, not every chart family; one chart list plus changed chart pages is enough.
6. **Writes:** keep daily snapshot writes bounded to the three groups and avoid rewriting provider metadata that has not changed where the schema does not require a daily observation.

This is orders of magnitude smaller than the previous global-Spotify-style scan and should remain a negligible share of Queue/D1 usage.

## Implementation priorities

1. Preserve additional safe metadata (`album_audio_id`, album ID, hash, duration, MV hash, raw `ownercount`) in parser output/tests.
2. Add a read-only diagnostic probe for artist pages/search payloads before introducing any signed client logic.
3. Capture real current responses for comment count, favourite count, rank list and song ranking from a permitted environment.
4. Only then decide which fields deserve canonical schema columns.
5. Prefer batch endpoints (`mixsongids`) and change-driven/rotating collection over per-track daily fan-out.

## Non-goals

- downloading audio or extracting protected playback URLs
- bypassing CAPTCHAs/device verification
- pretending external Oricon/Melon charts are Kugou streaming charts
- storing inferred counts as real playback/favourite/comment metrics
