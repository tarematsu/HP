# Local music platform collectors

## Goal

Collect public Sakurazaka46, Hinatazaka46, and Nogizaka46 activity from regional/local music streaming services and expose it through the existing Pages/Worker read-model pipeline.

Target aliases:

- 櫻坂46 / Sakurazaka46 / SAKURAZAKA46
- 日向坂46 / Hinatazaka46 / HINATAZAKA46
- 乃木坂46 / Nogizaka46 / NOGIZAKA46

Exact provider-native artist ownership is verified before a search result is stored. Missing/non-public metrics stay `null`; they are never converted to zero.

## Target services

| Region | Service | Public signals | Collector status |
| --- | --- | --- | --- |
| South Korea | Genie | cumulative track plays/listeners/likes, catalog | implemented |
| South Korea | Bugs! | artist likes, catalog, MusicPD playlists | implemented; playlist expansion remains |
| South Korea | Melon | artist fans, track likes, DJ playlists | implemented |
| South Korea | Naver VIBE | artist likes, catalog | implemented |
| Greater China / SEA | JOOX | artist followers, catalog/rankings/playlists | implemented; expansion remains |
| Mainland China | QQ Music | catalog/listen-order ranking | implemented |
| Mainland China | NetEase Cloud Music | hot-track rank, comments, catalog | implemented |
| Mainland China | Kugou Music | catalog/public ordering | implemented |
| Vietnam | NhacCuaTui | followers, plays, catalog/playlists | implemented; expansion remains |
| MENA | Anghami | track plays/likes, artist followers | implemented; expansion remains |
| Russia/CIS | Yandex Music | catalog | implemented |
| Africa / emerging markets | Boomplay | public web catalog | implemented through first-party search pages + song-page JSON-LD |
| Thailand | Plern | public catalog when available | implemented; currently reports `pending` while `plern.co` exposes a coming-soon surface |
| Thailand | Fungjai | legacy artist/music catalog | implemented; current service may return `pending` because Fungjai has evolved into a Music Integrator |
| Vietnam | Zing MP3 | catalog | implemented with signed web-API support; credentials are configuration, not hard-coded |
| India | JioSaavn | artist/catalog/search metadata | implemented |
| India | Gaana | artist/catalog/popularity ordering | implemented |
| Indonesia | Langit Musik | catalog | implemented but network collection is authorization-gated and disabled by default |
| South Korea | FLO | artist/catalog | implemented |

## Canonical collection fields

### Artist

- `service`
- `service_artist_id`
- `canonical_artist`
- `display_name`
- `profile_url`
- `followers`
- `likes`
- `collected_at`

### Track

- `service_track_id`
- `service_artist_id`
- `title`
- `canonical_track_id` when resolvable
- `plays`
- `listeners`
- `likes`
- `comments`
- `popularity_rank` only when explicitly published
- `collected_at`

### Playlist/chart inclusion

- `service_playlist_id`
- `playlist_name`
- `playlist_url`
- `service_track_id`
- `position`
- `playlist_type`
- `owner_name`
- `snapshot_date` / `collected_at`

## Architecture

Use a service-agnostic snapshot model rather than a separate Pages contract per provider.

Logical keys:

- artist snapshots: `(service, canonical_artist, snapshot_date)`
- track snapshots: `(service, service_track_id, snapshot_date)`
- playlist membership snapshots: `(service, service_playlist_id, service_track_id, snapshot_date)`
- provider identity mapping remains attached to the service-native ID

The public Pages API receives a pre-materialized `regional-music` R2 read model. Pages never live-scrapes providers. The dedicated collector owns publication of this model and is isolated from Spotify/Amazon collection.

## Collector behavior

1. Search Japanese and romanized aliases for all three groups.
2. Reject similar-name results unless the provider metadata identifies the target artist.
3. Persist stable provider IDs where available.
4. Fetch artist metrics, catalog tracks, track metrics, and playlist/chart membership independently.
5. Preserve `null` for non-public metrics.
6. Bound/rotate large catalog expansion.
7. Isolate upstream failures by service and retain previous good snapshots.
8. Publish health with last attempt/success, entity counts, and latest error class.
9. Do not silently bypass provider access controls. Credential/signature based collectors require explicit current configuration.
10. Langit Musik network collection stays disabled unless `LANGIT_MUSIK_AUTHORIZED_COLLECTION=1` is explicitly configured.

## Implementation details

All **19 / 19** planned services are connected to the scheduled Worker.

- **Genie:** dynamic artist search, artist likes, top-track IDs, cumulative listeners/plays/likes.
- **Bugs!:** stable artist IDs and daily artist likes.
- **JOOX:** stable artist IDs and daily followers.
- **NhacCuaTui:** followers plus seed-track plays.
- **Anghami:** seed-track plays/likes, artist-ID discovery and artist followers.
- **Melon:** artist search/fan metrics plus validated DJ playlist membership snapshots.
- **QQ Music:** exact-artist discovery plus listen-ordered top tracks.
- **NetEase Cloud Music:** exact artist discovery, hot-track rank, comments and rotating album catalog expansion.
- **Kugou Music:** exact-alias catalog search with provider-native track/artist identities.
- **Naver VIBE:** V4 exact-artist search, artist likes and release-track catalog snapshots.
- **FLO:** exact artist discovery, album discovery and rotating album-track expansion.
- **Yandex Music:** no-key JSON search with exact artist filtering and provider IDs.
- **Boomplay:** public first-party search page -> candidate song IDs -> song-page `MusicRecording` JSON-LD -> exact-artist verification.
- **Plern:** daily public-surface probe plus structured-data catalog parsing when the service exposes a searchable web catalog again.
- **Fungjai:** legacy `/artists/{slug}` discovery and `/musics/{slug}` track extraction; returns pending when no streaming catalog is exposed.
- **Zing MP3:** signed `/api/v2/search/multi` client with visitor-cookie handling and exact artist filtering. `ZING_MP3_API_KEY` and `ZING_MP3_SECRET_KEY` must be configured from an authorized/current client configuration.
- **JioSaavn:** exact-artist discovery plus song catalog snapshots.
- **Gaana:** current v2 exact-artist search plus popularity-sorted top tracks.
- **Langit Musik:** structured-data/legacy share-link parser with explicit authorization gate. No network requests are made unless authorized.

## Known provider identities / seeds

These are diagnostic seeds, not canonical identity replacements.

- Bugs! artist IDs: Sakurazaka46 `80348696`, Hinatazaka46 `80329579`, Nogizaka46 `80192968`.
- JOOX HK artist IDs: Sakurazaka46 `l3RBNJqESiqw84k4wFKQig==`, Hinatazaka46 `bBDS6Lsx44ux11K9H6vrKQ==`, Nogizaka46 `rsJfY_jmYjJ3Jrn7pdgwhA==`.
- Melon validated DJ playlist: `430097431`.
- QQ Music Nogizaka46 release seed: album ID `000HNVfX1PSixv`.
- NetEase Cloud Music Nogizaka46 release seed: album ID `278234837`.
- Kugou Music Nogizaka46 release seed: `cv1uyy99`.
- Naver VIBE Hinatazaka46 artist ID: `2834287`; normal collection still discovers identity through search.
- Yandex Music Hinatazaka46 artist ID: `7101843`; normal collection still uses exact-name discovery.

## Runtime constraints

- **Plern:** `plern.co` currently exposes a coming-soon page rather than a public music catalog. The collector records `pending/catalog_surface_unavailable` and retries each scheduled run.
- **Fungjai:** the current public site identifies Fungjai as a Music Integrator. Legacy artist/music URLs are still probed conservatively; no unrelated current event/marketing pages are stored as tracks.
- **Zing MP3:** signing credentials are intentionally not committed. When credentials are absent the collector records `pending/credentials_required`; when configured it performs the same normalized track snapshot flow as other providers.
- **Langit Musik:** automatic network access is disabled by default because published terms restrict automated collection. The parser/collector is present for an authorized endpoint or explicit permission, using `LANGIT_MUSIK_AUTHORIZED_COLLECTION=1` and optionally `LANGIT_MUSIK_SEARCH_URL_TEMPLATE`.

## Completion criteria

A provider is considered implementation-complete when:

- all three groups are searched under Japanese/romanized aliases;
- results are ownership-verified;
- provider IDs and public URLs are retained;
- safely exposed metrics have parsers/tests;
- bounded collection cadence is configured;
- degraded/pending behavior is explicit;
- snapshots feed the common R2 read model;
- Pages does not live-scrape the provider.

Runtime `pending` is distinct from implementation-incomplete: Plern, Fungjai, Zing MP3, and Langit Musik may legitimately remain pending until their external prerequisites are satisfied.

## Production steps

1. keep the PR draft through CI and provider parser verification;
2. apply the D1 migration;
3. deploy `sh-regional-music-collector`;
4. configure authorized Zing MP3 credentials if collection is permitted;
5. keep Langit Musik disabled unless explicit authorization/API access exists;
6. run the first collector pass and verify each provider independently;
7. verify `/api/regional-music` and the R2 materialized object before marking the PR ready.
