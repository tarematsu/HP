# Spotify daily-delta spike investigation

## Symptom

The production Spotify view showed an approximately -11.46 million then +12.14 million daily-delta spike for 乃木坂46 in late October, despite the current per-track table showing ordinary positive daily changes. This is a data-integrity incident, not a chart-styling issue.

## Evidence from production visual audit

- Latest available audit run: [Pages visual audit #40592578939](https://github.com/tarematsu/HP/actions/runs/40592578939).
- Screenshot timestamp: 2026-10-27T22:20:12Z (2026-10-28 07:20:12 JST); artifact `pages-visual-audit-40592578939-1`.
- Desktop screenshot `desktop-13-spotify.png` shows the negative/positive lifetime-sized spikes on the daily-delta chart, while the adjacent per-track table contains normal-sized deltas.
- The current main finalizer already carries forward a zero playcount when the previous count was positive, and PR #2274 added a regression test for the zero-count/rebound pattern.
- The historical repair workflow run [#40589410444](https://github.com/tarematsu/HP/actions/runs/40589410444) was skipped on the PR #2274 merge push. Its job requires the commit message marker `[repair-spotify-history]`; the merge commit did not include it. Therefore the guarded historical repair was never run, so the published graph can still expose the pre-fix daily rows.

## Root cause and repair

The confirmed immediate cause is that the historical D1 re-finalization step was not executed after the safeguard was merged. The workflow already has a bounded repair path: it scans the compact artist-daily summary for multi-million outliers, re-finalizes only the outlier dates and their adjacent dates from stored daily observations using the production finalizer, refreshes those artist summaries, and republishes the read model only if rows actually changed. It adds no recurring D1 workload.

This PR adds the investigation document to the workflow's push path filter so a documented incident can trigger the existing guarded repair when the merge commit carries `[repair-spotify-history]`. The workflow guard remains in place; ordinary documentation edits do not run the repair. The repair report must still be checked after merge. If outliers remain or no stored values change, continue tracing raw daily rows and the published read model rather than suppressing or clamping the graph.

## Validation and acceptance criteria

1. Run the repository JavaScript/source-contract tests and required CI.
2. Merge with the explicit `[repair-spotify-history]` marker so the existing repair workflow runs once after the production pipeline.
3. Verify the repair report shows no remaining outliers, and that the workflow republishes only when values changed.
4. Verify the post-repair Pages visual audit generates a fresh production artifact and the graph no longer contains lifetime-sized spikes.
5. Preserve genuine downward Spotify corrections and avoid recurring D1 reads/writes.
