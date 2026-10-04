# Shared leaderboard / follow refactor plan

This PR will consolidate the leaderboard and follow/follower surfaces used under the Stationhead and music streaming service sections so that each feature has one UI/runtime implementation and only its read-model adapter changes by source.

## Goals

- One shared leaderboard shell/runtime for Stationhead and music streaming service usage.
- One shared follow/follower shell/runtime for Stationhead and music streaming service usage.
- Keep source-specific data shaping inside read-model adapters rather than DOM/rendering code.
- Keep Stationhead leaderboard and followers as independent read models; do not merge their storage/update pipelines.
- Preserve materialized/R2-backed public reads and avoid introducing browser-triggered D1 reads.
- Keep route IDs unique even when visible labels are shared across sections.

## Implementation sequence

1. Extract the current Stationhead ranking UI from the history-specific runtime into a dedicated shared leaderboard shell/runtime without changing rendered behavior.
2. Add a leaderboard read-model adapter contract and move Stationhead-specific host/ranking normalization behind it.
3. Convert the existing followers shell/runtime into a shared follow surface and move Stationhead handles, memberships and source-specific normalization into a read-model adapter.
4. Add music streaming service adapters that emit the same normalized contracts, then expose the shared leaderboard/follow surfaces under that section using unique internal route IDs.
5. Update routing, asset loading and styles so both sections reuse the same implementation files.
6. Add/adjust regression tests covering shared shell/runtime use, route uniqueness, adapter boundaries and materialized-read behavior.
7. Run relevant site/worker tests and CI; fix regressions in this PR before merge.

## Non-goals

- Do not combine leaderboard and followers into one read model.
- Do not add live D1 fallback for public pages.
- Do not duplicate Stationhead and music-service rendering code under different filenames.
- Do not change collection cadence unless required to preserve an existing contract.

## Target architecture

Navigation -> shared shell/runtime -> source read-model adapter -> materialized API/read model.

The runtime should know how to render normalized leaderboard/follow data, but should not know Stationhead host handles, music-service provider details, D1 table names, or source-specific API response shapes.
