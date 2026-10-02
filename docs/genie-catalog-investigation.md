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

## Collection design constraints

- Current shared collector timeout: 90 seconds (`REGIONAL_MUSIC_COLLECTOR_TIMEOUT_MS`).
- Each ranked song currently writes three statements: track metadata, daily metrics, artist order.
- Full catalog collection must discover IDs separately and process bounded song batches with resumable daily progress. Do not merely remove the five-song cap inside one collector invocation.
- Completeness must compare advertised total, unique IDs, successful metric details and failures. Partial data stays available with degraded status.
- Public catalog entries are service song IDs; alternate editions/instrumentals may count separately. Never label their count as unique compositions.

## Reproducible verification

Run `node worker/scripts/probe-genie-catalog.mjs /tmp/genie-catalog-evidence` with Node and curl. The read-only probe enumerates pop7 pages for all three verified artist IDs, rejects duplicate/empty pages and validates two off-profile song details per artist. Evidence is JSON; no production database writes occur.

## Completed Sakurazaka46 verification

- 9 pages, 264 unique song IDs, equal to the advertised total; no repeated pages.
- Off-profile sample 115271728, Lonesome rabbit: plays 27, listeners 7.
- Catalog tail sample 91621795, Saisyu no Chikatetsu ni Notte: plays 1906, listeners 117.
- Both detail pages verified the same artist ID. Public metrics are cumulative.
- This confirms full song-ID discovery and off-profile metrics, not successful metric collection for every song.
