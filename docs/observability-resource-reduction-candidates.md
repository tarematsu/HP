# Cloudflare resource-reduction candidates

Research snapshot: 2026-10-20 15:06 UTC (Observability Status issue #259, workflow run #5157).
Base commit: `81249e0e90a85bfad72d82e3dfa01c4118cfcfe7`.

This is an investigation backlog, not a claim that any resource is currently in danger. Do not change collection cadence, drop history, or add writes/queue messages merely to improve a metric. Measure first and preserve recovery/diagnostic coverage.

## Current evidence

From [Cloudflare Observability Status #259](https://github.com/tarematsu/HP/issues/259) and its linked unified diagnostic:

- Overall status, public health, deployment health, runner health, D1 query insights, telemetry and R2 freshness gates reported success. Seven monitored Workers were active; no current CPU violations or errors were reported.
- Latest projected daily budgets at 2026-10-20 15:06 UTC: Worker/Pages requests 6,389 / 100,000; D1 rows read 219,756 / 5,000,000; D1 rows written 28,480 / 100,000; Queue billable operations 3,422 / 10,000.
- Account-wide Queue operations were 2,143 so far, with 33 queues in scope. R2 Class A operations were 139,213 month-to-date against 1,000,000; R2 Class B 384,924 against 10,000,000. These are below limits, but Class A is the closest listed monthly meter by percentage.
- D1 same-day snapshots are not internally comparable in the latest issue: the latest daily section reports 137,660 rows read to date, while the embedded same-day snapshot history has earlier samples up to 836,269. The diagnostic explicitly marks same-day delta pace UNKNOWN. Do not use these values to claim a precise short-term reduction or regression until the measurement path is reconciled.
- The issue lists the Spotify play-count collector as recently deployed; the history shows a recent optimization avoiding full-history aggregation for Spotify latest snapshot dates (#2255), and an idle Cron CPU reduction (#2256). Avoid redoing these without new query/telemetry evidence.

## Ranked candidates

### P1 — Explain and reduce R2 Class A operations (measure before changing)

Evidence: 139,213 month-to-date against 1,000,000 (about 13.9%); higher relative consumption than the other listed monthly/storage budgets. The current diagnostic provides bucket storage but not a useful per-prefix Class A attribution in the visible summary.

Next steps:
1. Attribute Class A operations by bucket, operation and caller (especially write/list/head patterns) from existing telemetry/API evidence.
2. Separate required object writes from redundant list/stat/probe operations.
3. If repeated reads/list calls are proven redundant, batch or reuse already-fetched manifests where correctness permits; do not add a cache with invalidation risk without evidence.
4. Verify month-to-date rate and production behavior after any future implementation.

Expected savings: unknown until attribution exists. No change recommended yet.

### P1 — Reconcile D1 daily usage snapshots before targeting queries

Evidence: the same-day D1 snapshot history and latest actual-to-date summary disagree materially; snapshot-delta pace is explicitly UNKNOWN. Earlier project history showed D1 read/write reduction work and query-insights gates, so a new optimization should be based on comparable windows and per-query fingerprints.

Next steps:
1. Fix/clarify snapshot selection and same-UTC-day comparison so the issue compares matching windows and clearly labels cumulative vs interval values.
2. Capture top query fingerprints by rows read/written, executions and average duration for a comparable interval.
3. Prioritize repeated scans or high rows-read-per-execution; do not optimize based only on daily totals.
4. Validate that any aggregation/read-model change preserves data completeness and repair behavior.

Expected savings: not estimable until measurement consistency and top-query evidence are available.

### P2 — Audit duplicate writes in legacy Stationhead revision/event persistence

Evidence from code search at the base commit:
- `worker/src/minute-facts-legacy-revision.js` writes `sh_queue_state_events` when the revision or pause state changes, using `INSERT OR IGNORE`.
- `worker/src/minute-revision-stages.js` writes `sh_queue_revision_items`.
- `worker/src/minute-queue-revision-progress.js` counts revision items and reads positions; `worker/src/minute-facts-store.js` and rebuild paths also read these items.
- Prior investigation identified `sh_queue_revision_items` (about 210 rows / 70 executions in that earlier sample) and `sh_queue_state_events` (about 54 rows / 18 executions) as candidates. Those counts are historical and must not be treated as current usage.

Next steps:
1. Use current D1 query insights and source-level counters to establish whether revision rows or state events are being re-created unnecessarily.
2. Confirm revision identity, uniqueness and pause-transition semantics; retain legitimate history and recovery inputs.
3. Add/adjust idempotency only if a reproducible duplicate is demonstrated, then compare writes and test revision reconstruction.

Expected savings: potentially modest; unknown until current execution and row counts are collected.

### P2 — Reduce repeated revision-item reads only if profiling confirms it

Evidence: current code has a count query and position lookup in the revision-progress path, and position lookups in live/sparse/rebuild fact storage. Some are necessary for correctness; they must not be collapsed based on code appearance alone.

Next steps:
1. Use D1 Insights to confirm these fingerprints are material contributors in production.
2. If confirmed, consider combining count/position access or reusing results within one invocation, while preserving ordering and validity checks.
3. Add tests for empty revisions, invalid schedule entries, missing positions and rebuild equivalence.

Expected savings: unknown; no query rewrite recommended without production query evidence.

### P3 — Queue operation attribution and duplicate message audit

Evidence: 2,143 Queue operations so far, projected 3,422 / 10,000. The diagnostic has 33 queues in scope; the visible breakdown includes the Spotify play-count queue with both writes and deletes. Current projected use is below the limit.

Next steps:
1. Compare per-queue writes, receives, retries and deletes from the full operation breakdown.
2. Identify retries/duplicate enqueues or messages that are immediately discarded; fix the source only when confirmed.
3. Keep retry and dead-letter safety; do not reduce polling or change batch sizes without latency/backlog checks.

Expected savings: unknown. Current evidence does not justify a Queue behavior change.

### P3 — Keep existing CPU reductions under regression watch

Evidence: #2256 reduced idle Sakurazaka Cron CPU without changing collection cadence. The latest issue reports no current CPU violations. This is already implemented, so avoid duplicating it.

Next steps: track comparable CPU p50/p95/max and invocation counts over several successful diagnostic windows. Reopen only if a measurable regression or high-cost invocation appears.

## Explicitly not recommended

- Reducing collection cadence or deleting historical facts to lower resource totals.
- Increasing D1 or Queue usage to make diagnostics more complete.
- Treating an UNKNOWN or stale measurement as proof of normal use or a specific saving.
- Changing production code before a reproducible cost source and correctness-preserving test are identified.

## Acceptance criteria for a future optimization PR

- Evidence includes a comparable baseline window and query/operation attribution.
- A stated expected reduction is measured after deployment.
- Required CI/tests pass; no new CPU, error, stale-data, collection-integrity or recovery regressions.
- Observability Status #259 confirms the post-deploy state and labels unavailable measurements as unknown rather than healthy.
