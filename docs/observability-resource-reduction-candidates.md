# Cloudflare resource-reduction candidates

Research snapshot: 2026-10-20 15:06 UTC (Observability Status issue #259, unified diagnostic run #5157).
Base commit: `81249e0e90a85bfad72d82e3dfa01c4118cfcfe7`.

This is a ranked investigation backlog, not a claim that any resource is currently in danger. No runtime behavior is changed by this document. Measure first; preserve collection completeness, freshness, history, retry safety and recovery paths.

## 1. Current evidence and measurement limits

Source: [Cloudflare Observability Status #259](https://github.com/tarematsu/HP/issues/259), generated 2026-10-20T15:06Z. Diagnostic workflow: [#5157](https://github.com/tarematsu/HP/actions/runs/39444646735).

### Daily budget projections at diagnostic time

| Meter | Projected usage | Limit | Approx. utilization |
|---|---:|---:|---:|
| Worker/Pages requests | 6,389/day | 100,000/day | 6.4% |
| D1 rows read | 219,756/day | 5,000,000/day | 4.4% |
| D1 rows written | 28,480/day | 100,000/day | 28.5% |
| Queue billable operations | 3,422/day | 10,000/day | 34.2% |

These are projections, not actual end-of-day totals. Queue and D1 write projections have more relative headroom pressure than request and D1 read projections, but projections alone do not identify a code-level cause.

### Monthly R2 and account-wide Queue usage

- Queue operations: 2,143 so far in the reported window/snapshot; 33 queues in scope.
- R2 Class A operations: 139,213 month-to-date / 1,000,000 (13.9%).
- R2 Class B operations: 384,924 month-to-date / 10,000,000 (3.8%).

R2 Class A is not near its limit, but its relative consumption is higher than Class B. The summary does not attribute Class A operations by bucket, operation or caller, so savings cannot yet be estimated.

### Data quality caveat: D1 same-day pace is UNKNOWN

The issue's daily summary reports 137,660 D1 rows read to date, while the embedded same-day snapshot history contains earlier samples up to 836,269. The diagnostic itself says a comparable snapshot pace is unavailable and requires the same UTC date and a 20m–2h interval. This is a measurement/selection issue until proven otherwise; do not label it a D1 workload regression or calculate savings from the inconsistent series.

### Runtime and collection evidence

- All 7 monitored Workers were active; public health endpoints returned HTTP 200; no CPU violations or errors were reported.
- Current telemetry showed: Sakurazaka Cron 49 samples, average 2.41ms, max 5ms; Cron dispatcher 57 samples, average 1.49ms, max 5ms; HomePanel HTTP 31 samples, average 1.19ms, max 7ms.
- Potentially expensive but within budget: Buddies collector Durable Object CPU average 125.7ms/max 148ms (3 samples); HomePanel Durable Object fetch max 243ms (12 samples across DO class) and alarm average 98ms (4 samples). Sample sizes are small and these are CPU—not wall-clock—durations.
- Spotify play-count collection completed: 300/300 albums, 870 tracks; actual track rows reported for Nogizaka 498, Sakurazaka 180 and Hinatazaka 194. These counts describe scope, not proof of redundant work.
- R2 collection freshness gate passed. Regional service source ages were within configured limits, but QQ Music was 125.6h old against a 192h limit and KKBOX 48.1h against 192h. Do not lower cadence or raise thresholds to reduce costs; first establish source-specific freshness requirements.
- Recent merged optimizations already avoid full-history aggregation for Spotify latest snapshot dates (#2255) and reduce idle Sakurazaka Cron CPU without changing cadence (#2256). Avoid duplicating them without new evidence.

## 2. Ranked candidates

Each candidate lists the evidence needed before implementation. Savings are unknown unless explicitly measured.

### P1 — Attribute R2 Class A operations

**Why investigate:** 139,213 monthly Class A operations (13.9% of listed limit), compared with 3.8% for Class B. The current summary has no useful caller/prefix attribution.

**Inspect:** existing R2/API telemetry, Cloudflare usage detail and workflow logs. Classify operations by bucket, operation type (write/list/head/read where available), caller and time window.

**Potential changes only if evidence supports them:**
- Avoid repeated list/head/stat calls when the same manifest or object metadata was already retrieved in the same execution.
- Batch related object writes only where the API and failure semantics permit.
- Remove redundant diagnostic probes only if equivalent coverage remains elsewhere.

**Guardrails:** Do not add a broad cache without explicit invalidation; do not remove R2 freshness/repair evidence. Compare Class A operations per successful collection and verify no missing/stale objects after rollout.

### P1 — Repair D1 usage snapshot comparability

**Why investigate:** D1 read/write pace is UNKNOWN because the reported current-day total and embedded snapshot history are inconsistent.

**Inspect:** snapshot timestamps, UTC-day bucketing, source labels, cumulative-versus-interval semantics, and the code choosing the baseline sample. Verify the same database/account scope and units on both samples.

**Potential change:** correct only the selection/labeling logic and tests; make the issue explicitly report UNKNOWN when no valid same-day 20m–2h pair exists. Do not change application query behavior as a workaround for broken measurement.

**Acceptance:** deterministic tests for stale samples, UTC midnight, out-of-order samples, cumulative counters, missing samples, counter reset and mismatched scopes. Diagnostic should not report a false healthy pace.

### P1 — Reduce D1 write cost by finding the actual top writers

**Why investigate:** projected D1 writes are 28,480/day against a 100,000/day limit (28.5%), the highest D1 daily utilization shown. No per-query writer attribution is present in the issue summary.

**Inspect:** D1 Query Insights and query fingerprints by rows written, executions, database, duration and invocation path. Separate useful domain writes from idempotent no-op writes and diagnostic bookkeeping.

**Potential changes:** use upsert/no-op guards or batch statements only where current SQL proves that identical data is repeatedly written; avoid updating timestamps when no domain value changed if those timestamps are not semantically meaningful.

**Guardrails:** never suppress legitimate observations, state transitions, recovery checkpoints or historical facts. Compare row writes per successful collection and test replay/idempotency semantics.

### P2 — Audit Stationhead queue revision and state-event writes

**Code references at base commit:**
- `worker/src/minute-facts-legacy-revision.js`: writes `sh_queue_state_events` on revision/pause-state changes using `INSERT OR IGNORE`.
- `worker/src/minute-revision-stages.js`: writes `sh_queue_revision_items`.
- Related reads occur in `worker/src/minute-queue-revision-progress.js`, `worker/src/minute-facts-store.js`, and rebuild paths.

An earlier investigation noted about 210 rows / 70 executions for revision items and 54 rows / 18 executions for state events; these are historical samples, not current production evidence.

**Inspect:** current query fingerprints and row counts per revision. Confirm unique keys, revision identity, pause/resume transitions, and whether duplicate work is already prevented by `INSERT OR IGNORE`.

**Potential change:** make repeated persistence idempotent only after a reproducible duplicate is shown. Preserve legitimate transition history and rebuild inputs.

### P2 — Profile repeated queue revision-item reads

**Code references:** `worker/src/minute-queue-revision-progress.js` counts revision items and reads positions; `worker/src/minute-facts-store.js` and live/sparse/rebuild stores query items by revision and position.

**Inspect:** query executions per invocation and rows scanned, not just source-code query count. Determine whether count and position reads happen on the same path and can safely share a result.

**Potential change:** reuse a result within one invocation or combine lookups only if D1 Insights shows material cost and the returned semantics remain equivalent.

**Tests:** empty revision, invalid schedule entry, missing position, reordered items, paused state and rebuild/live equivalence.

### P2 — Profile Durable Object CPU and storage round trips

**Why investigate:** Buddies collector DO CPU averaged 125.7ms/max 148ms across only 3 samples; HomePanel DO class included fetch max 243ms and alarm average 98ms. These values are not policy violations, but suggest a higher-cost path worth profiling if frequent.

**Inspect:** operation counts and CPU by DO method, storage get/put/list/delete counts, transaction boundaries, alarm rescheduling, and request volume per object. Increase sample coverage before prioritizing.

**Potential change:** combine storage operations into a transaction or reuse a value within one request only when measurements show repeated round trips. Coalesce redundant alarm rescheduling only if timing guarantees are unchanged.

**Guardrails:** preserve serialization, ordering, durability, alarm recovery and concurrency behavior. DO CPU is below its 30s policy; avoid premature optimization based on a few samples.

### P2 — Audit Spotify play-count collection request and persistence amplification

**Why investigate:** latest complete run covers 300/300 albums and 870 tracks; three groups have 498/180/194 actual track rows. This is a relatively broad collection surface, but the run is healthy and those counts do not prove waste.

**Inspect:** per-album source requests, retry counts, payload sizes, D1 writes per changed/unchanged track, and whether a single run revisits the same track via multiple albums. Review the recent optimization in #2255 first.

**Potential change:** eliminate confirmed duplicate source lookups or unchanged-row writes; batch only where API limits and retry behavior are preserved.

**Guardrails:** do not omit tracks or backfill history to reduce cost. Compare coverage, freshness, completeness and cost per completed album/run.

### P2 — Attribute Queue billable operations by queue and outcome

**Why investigate:** projected use is 3,422/day / 10,000 (34.2%); the diagnostic covers 33 queues. The summary shows Spotify play-count queue writes and deletes but does not establish the dominant source of billable operations.

**Inspect:** per-queue send, receive, retry, delete, age, batch size and dead-letter counts. Distinguish successful processing from retry churn and messages enqueued then immediately invalidated.

**Potential change:** prevent confirmed duplicate enqueues at the producer; improve batch efficiency only after checking latency and retry rates.

**Guardrails:** do not disable retries, reduce polling blindly, or suppress messages. Track backlog age, completion rate and dead-letter count alongside operations.

### P3 — Review Cron/dispatcher fan-out and scheduled no-op work

**Why investigate:** the latest 60-minute window showed 63 Cron dispatcher samples, average CPU 1.49ms/max 5ms and 136 subrequests; Sakurazaka Cron had 57 samples, average 2.41ms/max 5ms and 6 subrequests. CPU is low, but fan-out/subrequest counts may expose avoidable orchestration overhead.

**Inspect:** scheduled invocations by task, skipped/no-op tasks, subrequests per useful action and duplicate dispatches. Separate the dispatcher from downstream collectors.

**Potential change:** skip demonstrably unnecessary no-op work or combine metadata reads when tasks share the same already-fetched state. Do not change collection cadence without a separate freshness analysis.

**Guardrails:** preserve each collector's schedule, retry behavior, and freshness SLA. #2256 already reduces idle Sakurazaka Cron CPU; do not repeat that change.

### P3 — Review Workers/Pages request and subrequest amplification

**Why investigate:** requests are only 6.4% of the daily projected limit, but the Cron dispatcher generated 136 subrequests in the latest hour (63 samples). Total request count alone may hide fan-out.

**Inspect:** route/worker-level invocation counts, repeated internal HTTP calls, redirects, and whether Pages invokes a Worker only to fetch data already available in a read model.

**Potential change:** remove proven redundant internal hops or reuse a result within a request. Keep public health checks and external contracts intact.

**Guardrails:** no change to public response semantics, caching correctness or security boundaries without tests.

### P3 — Monitor collection freshness before any cadence proposal

**Evidence:** all configured R2 collection freshness checks passed. QQ Music source age was 125.6h against 192h, KKBOX 48.1h against 192h, and YouTube Music 0.1h against 48h.

**Action:** document the intended source-specific update frequency and actual upstream publication cadence. Only propose a cadence change if upstream data availability proves more frequent polling cannot produce new data and a freshness SLA explicitly permits it.

**Not recommended now:** no cadence reduction based on these snapshots alone.

### P3 — Reduce observability workflow overhead without weakening coverage

**Why investigate:** unified observability took 4m 23s; it runs hourly and covers deployments, health, budgets, query insights, telemetry, live-tail evidence and R2 freshness. A long duration is not itself proof of high Cloudflare usage, but repeated setup/API calls may be reducible.

**Inspect:** step durations and API calls from workflow run #5157. Identify repeated account/deployment/metrics lookups within the same run and reuse only immutable responses already fetched in that run.

**Potential change:** parallelize independent read-only checks or deduplicate identical API reads if rate limits and result freshness permit.

**Guardrails:** do not skip any gate, reduce sampling coverage, reuse data across runs, or mark missing telemetry healthy. Distinguish GitHub Actions runtime from Cloudflare billable usage.

## 3. Existing optimizations and regressions to avoid

- #2255: avoids full-history aggregation for Spotify latest snapshot dates.
- #2256: reduces idle Sakurazaka Cron CPU without changing collection cadence.
- Current diagnostic: no CPU policy violations, no recent errors, public health 200, 7/7 monitored Workers active.
- Current R2 collection freshness gate passed.
- D1 same-day read/write pace is UNKNOWN; do not use it to claim a regression or savings.
- The earlier D1 storage-size issue involving a placeholder database ID should be tracked separately as a diagnostic completeness defect; do not confuse it with a production D1 outage.

## 4. Suggested investigation order

1. Reconcile D1 snapshot comparability and extract top D1 writer/read query fingerprints.
2. Attribute R2 Class A operations by operation and caller.
3. Attribute Queue operations by queue and outcome.
4. Profile DO CPU/storage operations with a larger sample.
5. Inspect Spotify play-count per-run source requests and unchanged-row writes.
6. Inspect Cron fan-out and Observability workflow step/API-call duplication.
7. Implement one narrowly scoped change per PR with baseline and post-change comparison.

## 5. Required evidence before any implementation PR

Every optimization should state:
- baseline time window, scope and data source;
- operation/query fingerprint and measured cost;
- expected reduction and uncertainty;
- behavior/integrity invariants;
- targeted tests and required CI;
- post-deploy measurements over a comparable window;
- proof that freshness, completeness, recovery, retries and diagnostic coverage did not regress.

## 6. Explicitly not recommended

- Reducing collection cadence or deleting historical facts merely to lower totals.
- Adding D1 writes or Queue messages to improve diagnostics.
- Treating stale/UNKNOWN values as normal or as proof of savings.
- Removing health, telemetry, R2 freshness or repair checks to shorten workflows.
- Optimizing a query because it looks repetitive in source without production query evidence.
- Changing code before a reproducible cost source and correctness-preserving test are identified.
