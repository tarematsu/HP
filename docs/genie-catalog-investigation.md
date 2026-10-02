# Genie catalog collection investigation

## Verified findings

- Official artist profile: https://www.genie.co.kr/detail/artistInfo?xxnm=80988607
- On 2026-10-02 JST, Sakurazaka46 profile advertised 264 songs and 61 albums.
- The profile links its song and album tabs through fnGoArtistTab.
- Existing collector limits profile extraction to five songs; this is an implementation limit, not a demonstrated provider limit.

## In progress

- Resolve official song-list pagination and sort semantics.
- Verify all three artist catalogs and song detail cumulative plays/listeners.
- Bound network and database work; never report incomplete catalogs as complete.
- Keep popularity ordering separate from release-date or album ordering.

## Pagination verified

- `GET /detail/artistSong?xxnm=80988607` returns 30 songs and advertises 264 total.
- Official inline JavaScript posts `xxnm`, `pg`, `pgsize=30`, `otype`, `stype` to `/detail/bArtistSongList`.
- A real page-2 response returned 30 additional song IDs.
- Default `otype=pop7` explicitly means recent-week popularity. Other offered sorts: `pop0` (all time), `pop90` (three months), `newest`, `name`.
- These popularity sorts qualify as provider_popularity_order; chronological/name/album order must not be saved as popularity.
