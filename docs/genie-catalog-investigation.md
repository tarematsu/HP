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

## Final verification — 2026-10-02 JST

| Artist | Advertised songs | Unique IDs fetched | Pages | Off-profile metric samples |
| --- | ---: | ---: | ---: | ---: |
| Sakurazaka46 | 264 | 264 | 9 | 2/2 |
| Nogizaka46 | 998 | 998 | 34 | 2/2 |
| Hinatazaka46 | 348 | 348 | 12 | 2/2 |

- All 1,610 catalog song IDs were discovered with no empty or repeated pages; each artist matched its advertised total.
- All six off-profile song-detail samples verified artist identity and exposed cumulative plays and listeners.
- Nogizaka46 tail sample 82608923, Sekaide Ichiban Kodokuna Lover: 11,004 plays, 983 listeners.
- Evidence: `docs/evidence/genie-full-catalog.json`. Probe exited successfully. Script syntax and seven focused Genie/order tests passed.
- Estimated daily full-detail work at current counts: 55 catalog pages plus 1,610 song detail requests, with profile/search overhead; about 4,830 song-storage SQL statements using the current three-write ranked-song path. These are estimates, not measured D1 usage.
- Conclusion: full public catalog discovery works, and broader cumulative metric collection has a verified route. Full 1,610-song metric coverage was not attempted in this investigation. Implement resumable batches and partial-failure accounting before production expansion.
- Production collector remains at five songs per artist; this PR is research/evidence, not a deployed expansion.

## Active implementation: all 19 regional services

- Single main-only Actions schedule: `0 15 * * *` = 00:00 JST.
- QQ Music and NetEase Cloud Music collect daily. The remaining 17 providers, including Genie, collect every Monday at 00:00 JST. Monday runs each service once.
- All newly collected artists, tracks, releases, playlists, memberships, per-artist orders and collector health save to per-service daily/latest R2 JSON. Collection has no D1 binding, no per-track messages, and no per-provider Queue messages.
- Genie retains verified full-catalog pagination, a maximum of four simultaneous detail requests, 100-song persistent checkpoints and a 38-minute soft budget. Other providers reuse their existing parsers with R2 storage hooks and 90-second fetch budgets.
- Scheduled same-day reruns reuse complete provider snapshots; failures retry. Manual all-service collection explicitly refreshes via the same shared R2 lock.
- Old per-minute dispatch is disabled. The separate 07:00 Genie workflow is removed. The legacy manual queue script is blocked from executing; manual workflow uses the R2 collector.
- One final publication message per run refreshes the shared read model. Worker publication and deployment/manual bootstrap merge all 19 R2 snapshots, preserving per-service timestamps and error health. Existing D1 observations remain a read fallback during migration; no new regional observations are written to D1 by the active workflows.
- First R2 collection seeds prior observations from the existing published R2 response without a D1 migration query. Explicit empty playlist snapshots clear old memberships, including on later partial failures.
- Design estimate: daily QQ/NetEase collection writes four snapshot objects, plus one shared read-model publication. A weekly full run at the verified Genie count writes about 56 snapshot/checkpoint objects, plus publication. Provider HTTP requests and Actions runtime remain necessary; billing has not been measured.
- New scheduled data collection begins after merge/production deployment. No deployment has occurred yet.
