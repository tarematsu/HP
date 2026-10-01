# Local music platform collectors

## Goal

Collect public Sakurazaka46, Hinatazaka46, and Nogizaka46 activity from regional/local music streaming services and expose it through the existing Pages/Worker read-model pipeline.

Target artist aliases must be normalized before storage/display:

- 櫻坂46 / Sakurazaka46 / SAKURAZAKA46
- 日向坂46 / Hinatazaka46 / HINATAZAKA46
- 乃木坂46 / Nogizaka46 / NOGIZAKA46

Do not merge unrelated artists solely because a localized service returns a similar name. Prefer stable service-native artist/track/playlist IDs once discovered.

## Target services

| Region | Service | Initial public signals to collect | Initial status |
| --- | --- | --- | --- |
| South Korea | Genie | artist/track presence, track cumulative plays, cumulative listeners, likes, albums | collector implemented; production verification pending |
| South Korea | Bugs! | artist likes, tracks/albums, popularity ordering, MusicPD playlist inclusion | artist metric collector implemented; playlist expansion pending |
| South Korea | Melon | artist fans, track likes, DJ playlists, chart/playlist inclusion where public | artist discovery + DJ playlist collector implemented; production verification pending |
| South Korea | Naver VIBE | artist/track presence, public playlist/chart inclusion and public engagement values | discovery; public web verification is robots-limited |
| Greater China / SEA | JOOX | artist followers, tracks/albums, popularity/ranking, comments/playlist inclusion where public | follower collector implemented; track/playlist expansion pending |
| Mainland China | QQ Music | artist followers/fans where public, tracks, charts, playlists, comments/engagement where public | catalog verified for Nogizaka46; collector pending |
| Mainland China | NetEase Cloud Music | artist followers, track popularity/comments, playlists, charts where public | catalog verified for Nogizaka46; collector pending |
| Mainland China | Kugou Music | artist/track presence, public popularity/chart/playlist signals | catalog verified for Nogizaka46; collector pending |
| Vietnam | NhacCuaTui | artist followers, tracks/albums, popular tracks, user playlist inclusion | follower + seed-track play collector implemented; catalog expansion pending |
| Middle East / MENA | Anghami | artist/track presence, track plays, likes, playlists where public | seed-track metrics + artist discovery collector implemented; catalog expansion pending |
| Russia/CIS | Yandex Music | artist/track presence, charts/playlists and public engagement values where exposed | discovery |
| Africa / international emerging markets | Boomplay | artist/track presence, plays/favorites/comments/playlists where public | Nogizaka46 catalog presence verified; collector pending |
| Thailand | Plern | artist/track presence and any public plays/followers/charts/playlists | discovery |
| Thailand | Fungjai | artist/track presence and public discovery/playlist signals if relevant catalog exists | discovery |
| Vietnam | Zing MP3 | artist/track presence, charts, playlists and public engagement values | discovery |
| India | JioSaavn | artist/track presence, playlists/charts and public engagement values | discovery |
| India | Gaana | artist/track presence, playlists/charts and public engagement values | discovery |
| Indonesia | Langit Musik | artist/track presence, charts/playlists and public engagement values | discovery |
| South Korea | FLO | artist/track presence, public charts/playlists/engagement values | discovery; public pages currently unstable in external verification |

## Canonical collection fields

Collectors should map service-specific data onto shared fields where available. Missing or non-public values remain null; never synthesize counts from ranking positions.

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
- `popularity_rank` or service-native rank when explicitly published
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

The public Pages API should receive pre-materialized R2 read models. Avoid dashboard-time D1 joins/scans. The collector should perform identity resolution before publishing the read model, following the existing Spotify/Amazon/Apple direction.

## Collector behavior

1. Discover service-native artist IDs for all three groups using all listed name variants.
2. Persist stable IDs so normal scheduled runs do not repeatedly search by free text.
3. Fetch artist metrics, catalog tracks, track metrics, and playlist/chart membership independently so one unavailable surface does not discard the rest.
4. Record `null` for values not exposed by the service. Do not convert missing values to zero.
5. Keep raw service IDs and URLs for diagnosis and future canonicalization.
6. Rate-limit per service and use small rotating batches for track/playlist expansion.
7. Treat upstream 4xx/5xx/layout changes as service-specific degraded states rather than corrupting prior good snapshots.
8. Publish a health summary containing last success, last attempted collection, entity counts, and latest error class per service.

## Rollout order

### Phase 1 — collectors with clearly public numeric metrics

- Genie
- Bugs!
- JOOX
- NhacCuaTui
- Anghami

### Phase 2 — China/Korea platform expansion

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

These are diagnostic seeds, not canonical identity replacements. Discovery must still verify artist ownership before expansion.

- Bugs! artist IDs: Sakurazaka46 `80348696`, Hinatazaka46 `80329579`, Nogizaka46 `80192968`.
- JOOX HK artist IDs: Sakurazaka46 `l3RBNJqESiqw84k4wFKQig==`, Hinatazaka46 `bBDS6Lsx44ux11K9H6vrKQ==`, Nogizaka46 `rsJfY_jmYjJ3Jrn7pdgwhA==`.
- Melon validated DJ playlist: `430097431` (`역대 오리콘 차트 명곡`); Nogizaka46 entries are currently observable there.
- QQ Music Nogizaka46 release seed: album ID `000HNVfX1PSixv`.
- NetEase Cloud Music Nogizaka46 release seed: album ID `278234837`.
- Kugou Music Nogizaka46 release seed: `cv1uyy99`.

## Completion criteria per service

A service is not considered complete merely because an artist page was found. Mark it complete only after:

- all three groups were searched under Japanese and romanized names;
- stable service IDs are stored for every found artist/track/playlist;
- every publicly exposed metric has a parser and regression fixture/test;
- collection cadence and rate limiting are configured;
- failure/degraded-state behavior is tested;
- snapshot persistence and R2 read-model publication are implemented;
- Pages can display service health and collected values without live scraping;
- duplicate aliases/localized titles are normalized without collapsing distinct service-native tracks.

## Implementation status

Current PR implementation:

- generic D1 schemas for artist, track, playlist-membership and collector-health snapshots;
- a 19-service registry and three-group alias normalizer;
- dedicated `sh-regional-music-collector` scheduled Worker, isolated from Spotify/Amazon collection;
- daily collection at 00:20 JST;
- Genie: dynamic artist search, artist likes, rotating top-track IDs, cumulative listeners/plays/likes;
- Bugs!: stable artist IDs and daily artist likes;
- JOOX: stable artist IDs and daily followers;
- NhacCuaTui: daily followers plus seed-track plays;
- Anghami: seed-track plays/likes, artist-ID discovery and artist followers;
- Melon: artist search/fan metrics plus target-track membership snapshots from validated DJ playlists;
- regression tests for alias normalization, service registry, parsers and Worker deployment selection.

Still required before this PR is production-complete:

1. expand Phase 1 collectors from seed/top-track coverage to full catalog and discoverable playlists;
2. implement QQ Music / NetEase Cloud Music / Kugou Music collectors using the verified release seeds, then VIBE/FLO fallbacks;
3. implement the Phase 3 regional services where public surfaces can be collected reliably;
4. publish a compact R2 read model and expose it to Pages without live provider requests;
5. run production verification after D1 migration/Worker deployment and keep the PR draft until real responses are confirmed.
