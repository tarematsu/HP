# Local music platform collectors

## Goal

Collect public Sakurazaka46, Hinatazaka46, and Nogizaka46 activity from regional/local music streaming services and expose it through the existing Pages/Worker read-model pipeline.

Target artist aliases are normalized before storage/display:

- 櫻坂46 / Sakurazaka46 / SAKURAZAKA46
- 日向坂46 / Hinatazaka46 / HINATAZAKA46
- 乃木坂46 / Nogizaka46 / NOGIZAKA46

Do not merge unrelated artists solely because a localized service returns a similar name. Prefer stable service-native artist/track/playlist IDs once discovered.

## Target services

| Region | Service | Public signals | Status |
| --- | --- | --- | --- |
| South Korea | Genie | track cumulative plays/listeners/likes, catalog | collector implemented; production verification pending |
| South Korea | Bugs! | artist likes, catalog, MusicPD playlists | artist metric collector implemented; playlist expansion pending |
| South Korea | Melon | artist fans, track likes, DJ playlists | artist discovery + DJ playlist collector implemented |
| South Korea | Naver VIBE | catalog, playlist/chart inclusion | album-track API verified; reliable artist discovery still pending |
| Greater China / SEA | JOOX | artist followers, catalog, rankings/comments/playlists | follower collector implemented; expansion pending |
| Mainland China | QQ Music | catalog, listen-order ranking, public engagement where exposed | exact artist discovery + listen-ordered track collector implemented |
| Mainland China | NetEase Cloud Music | hot-track rank, comments, catalog | exact artist discovery + hot tracks + rotating album expansion + comments implemented |
| Mainland China | Kugou Music | catalog, public popularity/chart signals | exact-alias catalog collector implemented |
| Vietnam | NhacCuaTui | followers, plays, catalog/playlists | follower + seed-track play collector implemented; expansion pending |
| MENA | Anghami | track plays/likes, artist followers, catalog/playlists | seed-track metrics + artist discovery/followers implemented; expansion pending |
| Russia/CIS | Yandex Music | catalog, charts/playlists | no-key JSON search collector implemented |
| Africa / emerging markets | Boomplay | plays/favorites/comments/catalog/playlists | catalog presence verified; first-party collection surface still pending |
| Thailand | Plern | catalog and any public metrics/charts/playlists | discovery pending |
| Thailand | Fungjai | historical local streaming/catalog discovery | no current streaming-catalog collector: service has evolved into a Music Integrator/community platform |
| Vietnam | Zing MP3 | catalog, charts/playlists/engagement | signed/cookie-dependent web API; stable public collection path pending |
| India | JioSaavn | artist/catalog/search metadata | exact artist + song catalog collector implemented |
| India | Gaana | artist/catalog/popularity ordering | current v2 artist search + popularity-sorted top-track collector implemented |
| Indonesia | Langit Musik | catalog/charts/playlists | automated collector intentionally blocked: published terms prohibit crawling/scraping/automated collection |
| South Korea | FLO | artist/catalog | exact artist discovery + rotating album catalog collector implemented |

## Canonical collection fields

Collectors map service-specific data onto shared fields where available. Missing or non-public values remain null; never synthesize counts from ranking positions.

### Artist

- `service`
- `service_artist_id`
- `canonical_artist` (`sakurazaka46`, `hinatazaka46`, `nogizaka46`)
- `display_name`
- `profile_url`
- `followers`
- `likes`
- `collected_at`

### Track

- `service_track_id`
- `service_artist_id`
- `title`
- `canonical_track_id` when resolvable through the existing track metadata layer
- `plays`
- `listeners`
- `likes`
- `comments`
- `popularity_rank` only when the service explicitly publishes an ordering
- `collected_at`

### Playlist/chart inclusion

- `service_playlist_id`
- `playlist_name`
- `playlist_url`
- `service_track_id`
- `position` when explicitly published
- `playlist_type` (`official`, `editorial`, `user`, `chart`, `unknown`)
- `owner_name` when public
- `snapshot_date` / `collected_at`

## Storage/read-model direction

Use a service-agnostic schema/read model rather than creating a separate Pages data contract for every provider.

Logical keys:

- artist snapshots: `(service, canonical_artist, snapshot_date)`
- track snapshots: `(service, service_track_id, snapshot_date)`
- playlist membership snapshots: `(service, service_playlist_id, service_track_id, snapshot_date)`
- service identity aliases: `(service, entity_type, service_id) -> canonical id`

The public Pages API receives a pre-materialized R2 read model. Pages never live-scrapes providers. `regional-music` is producer-owned by the dedicated collector and is intentionally excluded from the generic GitHub Actions materialization cadence.

## Collector behavior

1. Discover service-native artist IDs for all three groups using listed Japanese and romanized aliases.
2. Persist stable IDs so normal scheduled runs avoid repeated free-text discovery where possible.
3. Fetch artist metrics, catalog tracks, track metrics, and playlist/chart membership independently.
4. Record `null` for values not exposed by the service; do not convert missing values to zero.
5. Keep service IDs and public URLs for diagnosis and future canonicalization.
6. Use bounded/rotating batches for large catalog and playlist expansion.
7. Treat upstream HTTP/layout/API changes as service-specific degraded states without deleting prior good snapshots.
8. Publish collector health with last attempt/success, entity counts, and latest error class.
9. Do not implement an automated collector when the provider's published terms explicitly prohibit automated collection.

## Rollout order

### Phase 1 — public numeric metrics

- Genie
- Bugs!
- JOOX
- NhacCuaTui
- Anghami

### Phase 2 — China/Korea expansion

- QQ Music
- NetEase Cloud Music
- Kugou Music
- Melon
- Naver VIBE
- FLO

### Phase 3 — remaining regional platforms

- Yandex Music
- Boomplay
- Plern
- Fungjai
- Zing MP3
- JioSaavn
- Gaana
- Langit Musik

## Known service identities / seeds

These are diagnostic seeds, not canonical identity replacements. Discovery still verifies artist ownership before expansion.

- Bugs! artist IDs: Sakurazaka46 `80348696`, Hinatazaka46 `80329579`, Nogizaka46 `80192968`.
- JOOX HK artist IDs: Sakurazaka46 `l3RBNJqESiqw84k4wFKQig==`, Hinatazaka46 `bBDS6Lsx44ux11K9H6vrKQ==`, Nogizaka46 `rsJfY_jmYjJ3Jrn7pdgwhA==`.
- Melon validated DJ playlist: `430097431` (`역대 오리콘 차트 명곡`); Nogizaka46 entries are observable there.
- QQ Music Nogizaka46 release seed: album ID `000HNVfX1PSixv`.
- NetEase Cloud Music Nogizaka46 release seed: album ID `278234837`.
- Kugou Music Nogizaka46 release seed: `cv1uyy99`.
- Naver VIBE Hinatazaka46 artist ID: `2834287`; album tracks are exposed under `/vibeWeb/musicapiweb/album/{albumId}/tracks`.
- Yandex Music Hinatazaka46 artist ID: `7101843`; collection still uses exact-name discovery rather than trusting the seed alone.

## Provider constraints

- **Langit Musik:** published terms prohibit crawling and other automated methods including bots, scrapers, and spiders for viewing/accessing/collecting service information. Do not deploy an automated collector without an authorized API or explicit permission.
- **Fungjai:** the current service describes itself as having started as a local streaming service in 2014 and now being a Music Integrator/community platform. A current general music-catalog surface has not been established.
- **Zing MP3:** current web API access depends on request signatures/API-key/cookie state. Do not hard-code leaked/stale keys or signatures.
- **Boomplay:** public catalog presence exists, but collection should use a first-party public surface rather than silently depending on a third-party metadata proxy.
- **Naver VIBE:** known album endpoints are not enough; artist identity discovery must be reliable before scheduled collection is enabled.

## Completion criteria per service

A service is not considered complete merely because an artist page was found. Mark it complete only after:

- all three groups were searched under Japanese and romanized names;
- stable service IDs are stored for found artists/tracks/playlists;
- every safely/publicly exposed metric used by the collector has a parser and regression fixture/test;
- collection cadence and request bounds are configured;
- failure/degraded-state behavior is tested;
- snapshot persistence and R2 read-model publication are implemented;
- Pages can display service health and values without live scraping;
- duplicate aliases/localized titles are normalized without collapsing distinct service-native tracks.

A service may instead be marked `blocked` when its published terms disallow automated collection or when the only known method requires unstable/non-public authentication material.

## Implementation status

Currently connected to the scheduled Worker: **13 services**.

- Genie: dynamic artist search, artist likes, top-track IDs, cumulative listeners/plays/likes.
- Bugs!: stable artist IDs and daily artist likes.
- JOOX: stable artist IDs and daily followers.
- NhacCuaTui: daily followers plus seed-track plays.
- Anghami: seed-track plays/likes, artist-ID discovery and artist followers.
- Melon: artist search/fan metrics plus validated DJ playlist membership snapshots.
- QQ Music: smartbox exact-artist discovery plus listen-ordered top tracks.
- NetEase Cloud Music: exact artist discovery, hot-track rank, comments and rotating album catalog expansion.
- Kugou Music: exact-alias filtered song search with service-native track/artist identities.
- FLO: exact artist discovery, album discovery and rotating album track expansion.
- Yandex Music: API-key-free JSON search with exact artist filtering and provider artist/album/track IDs.
- JioSaavn: autocomplete exact-artist discovery plus song-search catalog snapshots.
- Gaana: current v2 exact-artist search plus popularity-sorted artist top-track snapshots.

Shared implementation:

- generic D1 schemas for artist, track, playlist-membership and collector-health snapshots;
- 19-service registry and three-group alias normalizer;
- dedicated `sh-regional-music-collector` Worker, isolated from Spotify/Amazon collection;
- daily run at 00:20 JST;
- compact `regional-music` R2 read model and Pages API route;
- direct R2 reads for the producer-owned regional model;
- regression tests for identity normalization, provider parsers, read model, API contract and Worker deployment selection.

Remaining work:

1. expand Phase 1 seed/top-track collectors toward full catalog and playlist coverage where public and permitted;
2. finish Naver VIBE artist discovery;
3. find first-party stable collection surfaces for Boomplay and Plern;
4. determine whether Zing MP3 can be collected without unstable/private auth material;
5. treat Fungjai as discovery-only unless a current streaming catalog returns;
6. do not automate Langit Musik without permission/authorized API;
7. deploy migration/Worker only after the draft PR is ready, then verify real provider responses and the first healthy `regional-music` production read model.
