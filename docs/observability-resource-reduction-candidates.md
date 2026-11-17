# Cloudflare resource-reduction candidates (excluding R2)

Research snapshot: 2026-10-20 15:06 UTC, Observability Status issue #259 and unified diagnostic run #5157.
Base commit: `81249e0e90a85bfad72d82e3dfa01c4118cfcfe7`.

Scope: investigate and reduce Cloudflare D1, Queue, Worker, Durable Object, Pages/internal HTTP and collection-work costs. **R2 is explicitly excluded** because its budget has sufficient headroom. This is a research backlog, not a claim that every candidate is a proven waste. No runtime behavior is changed by this document.

## 1. Evidence and limits

Source: [Cloudflare Observability Status #259](https://github.com/tarematsu/HP/issues/259), generated 2026-10-20T15:06Z. [Unified diagnostic run #5157](https://github.com/tarematsu/HP/actions/runs/39444646735).

### Daily projections at snapshot time

| Meter | Projected usage | Limit | Utilization |
|---|---:|---:|---:|
| Worker/Pages requests | 6,389/day | 100,000/day | 6.4% |
| D1 rows read | 219,756/day | 5,000,000/day | 4.4% |
| D1 rows written | 28,480/day | 100,000/day | 28.5% |
| Queue billable operations | 3,422/day | 10,000/day | 34.2% |

These are projections, not end-of-day totals. Queue operations and D1 writes have the highest relative utilization among the listed daily meters. The numbers alone do not identify a wasteful code path.

### Diagnostic reliability and runtime

- All 7 monitored Workers were active; public health endpoints returned HTTP 200; no CPU policy violations or recent errors were reported.
- D1 same-day pace is marked UNKNOWN: the daily summary reported 137,660 rows read to date, while same-day snapshot history had earlier values up to 836,269. A comparable baseline requires same UTC day, matching scope and a 20m–2h interval. Treat this first as a measurement selection/labeling defect, not proof of workload regression.
- Telemetry snapshot: Sakurazaka Cron 49 samples, average CPU 2.41ms, max 5ms; Cron dispatcher 57 samples, average 1.49ms, max 5ms; HomePanel HTTP 31 samples, average 1.19ms, max 7ms.
- Higher-cost paths worth measuring, not assumed problematic: Buddies collector Durable Object CPU average 125.7ms/max 148ms (only 3 samples); HomePanel Durable Object fetch max 243ms and alarm average 98ms (12 and 4 samples respectively). These are CPU durations and sample sizes are small.
- Spotify play-count collection completed 300/300 albums and 870 tracks; reported actual track rows: Nogizaka 498, Sakurazaka 180, Hinatazaka 194. These figures describe coverage, not duplication.
- Recent changes already avoid full-history aggregation for Spotify latest snapshot dates (#2255) and reduce idle Sakurazaka Cron CPU without changing collection cadence (#2256). Avoid duplicating these without fresh evidence.
- R2 metrics are intentionally omitted from this backlog: available headroom is sufficient, so no R2 optimization is proposed.

## 2. Ranked candidates

### P1 — Fix D1 usage measurement comparability before cost decisions

**Evidence:** daily D1 read summary and same-day snapshot series disagree; pace is UNKNOWN.

**Inspect:** snapshot timestamps, UTC-day bucketing, cumulative-versus-interval semantics, source labels, account/database scope, sample ordering and baseline-selection logic.

**Candidate:** correct the selection/labeling logic only; report UNKNOWN when there is no valid comparable pair. Add deterministic tests for UTC midnight, stale/out-of-order samples, missing samples, counter reset, cumulative counters and mismatched scopes.

**Acceptance:** issue output never compares unlike windows or presents missing evidence as healthy. Do not change application SQL as a workaround for faulty measurement.

### P1 — Identify the top D1 writers by fingerprint

**Evidence:** projected writes 28,480/day against 100,000/day (28.5%); current summary lacks per-query attribution.

**Inspect:** D1 Query Insights by database, fingerprint, executions, rows written, duration and caller. Separate domain facts, idempotent no-op writes, indexes/migrations, and diagnostic bookkeeping.

**Potential savings:** guard updates that rewrite identical values; avoid semantically unnecessary timestamp churn; batch related writes where transaction and retry semantics remain equivalent. Only implement when the query is proven material.

**Validation:** measure writes per successful collection and verify replay/idempotency, historical fact retention, state transitions, repair checkpoints and collection completeness.

### P1 — Identify the top D1 readers by rows scanned and repetition

**Inspect:** query fingerprints by rows read per execution, total rows read, executions and average/p95 duration. Look for unbounded scans, redundant count-plus-detail reads, repeated queries within one invocation, and reads that ignore a suitable existing index.

**Potential savings:** add/adjust an index only when query plans and production fingerprints support it; narrow predicates; reuse already-fetched results within one invocation; replace repeated full-history aggregation with incremental/read-model access where equivalent.

**Guardrails:** account for index write overhead and migration cost. Do not add indexes merely because a query exists. Test empty data, boundary timestamps, pagination, ordering and rebuild equivalence.

### P1 — Audit Stationhead revision-item writes and state-event idempotency

**Code references at base commit:** `worker/src/minute-facts-legacy-revision.js` writes `sh_queue_state_events` on revision/pause-state changes using `INSERT OR IGNORE`; `worker/src/minute-revision-stages.js` writes `sh_queue_revision_items`. Related reads occur in `worker/src/minute-queue-revision-progress.js`, `worker/src/minute-facts-store.js` and rebuild paths.

Historical investigation samples were about 210 revision-item rows / 70 executions and 54 state-event rows / 18 executions. They are not current production evidence.

**Inspect:** current query fingerprints, rows per revision, uniqueness keys, conflict behavior, and revision/pause/resume semantics. Determine whether the producer regenerates the same revision unnecessarily.

**Potential savings:** skip confirmed duplicate persistence or avoid rebuilding identical revision rows, but only if a repeatable case is demonstrated. Preserve legitimate state-transition history and repair/rebuild inputs.

### P2 — Reduce repeated Stationhead revision-item reads

**Inspect:** per-invocation execution counts and rows scanned for revision counts, position lookups and live/sparse/rebuild storage. Determine whether the same revision is counted and queried multiple times on the same path.

**Potential savings:** reuse a result within an invocation or combine lookups if Insights shows material cost and the result remains semantically identical.

**Tests:** empty revisions, invalid schedule entries, missing positions, reordered items, pause state, sparse history and live/rebuild equivalence.

### P2 — Profile Durable Object storage round trips and CPU hot paths

**Evidence:** Buddies collector DO CPU average 125.7ms/max 148ms across 3 samples; HomePanel DO fetch max 243ms and alarm average 98ms in small samples.

**Inspect:** CPU by DO method; storage get/put/list/delete counts; transaction use; repeated state deserialization; alarm rescheduling; request volume per object; wall time separately from CPU.

**Potential savings:** consolidate proven repeated storage reads into a transaction or reuse a value within a single invocation; avoid redundant writes when persisted state is unchanged; coalesce alarm updates only if deadlines remain identical.

**Guardrails:** preserve serialization, ordering, durability, concurrency, alarm recovery and object identity. Increase sample size before prioritizing. These figures are far below the 30-second CPU policy and do not justify risky refactoring alone.

### P2 — Audit Spotify play-count source-request amplification

**Evidence:** latest complete run covered 300/300 albums and 870 tracks; this is a broad collection surface but not evidence of redundant work. #2255 already optimizes latest-date aggregation.

**Inspect:** source requests per album, pagination, retries, duplicate track IDs across albums, payload sizes, D1 writes for changed vs unchanged values, and work repeated between adjacent runs.

**Potential savings:** deduplicate identical source lookups within a run; skip unchanged-row writes where timestamps are not meaningful; avoid fetching historical pages when the requested snapshot needs only the latest data.

**Guardrails:** preserve album/track coverage, retry behavior, rate-limit handling, backfill support and data freshness. Report cost per completed album/run alongside missing-track counts.

### P2 — Attribute Queue billable operations by queue and outcome

**Evidence:** projected 3,422/day / 10,000 (34.2%); 33 queues are in diagnostic scope. Current summary does not establish the dominant source of billable operations.

**Inspect:** per-queue send/receive/delete/retry counts, batch sizes, age, duplicate payloads, dead-letter volume and producer/consumer outcomes. Distinguish useful completed messages from retry churn or messages invalidated immediately after enqueue.

**Potential savings:** prevent confirmed duplicate enqueue at the producer; improve batch efficiency only if latency and retry behavior remain acceptable.

**Guardrails:** do not disable retries, suppress messages or reduce polling blindly. Track backlog age, completion rate, failure rate and dead-letter count with operations.

### P2 — Reduce Queue retry churn without weakening delivery

**Inspect:** message attempts per successful completion, visibility-timeout expirations, poison messages, transient-vs-permanent errors, and whether a message can be enqueued twice for the same logical work.

**Potential savings:** fix the originating idempotency key or error classification when duplicate work is demonstrated; use bounded retry/backoff consistent with existing delivery guarantees.

**Acceptance:** tests cover duplicate delivery, worker crash after side effect, transient failure, poison message, DLQ/replay and exactly-once assumptions (do not assume Queue itself provides exactly-once delivery).

### P2 — Audit queue lifecycle and payload size

**Inspect:** whether messages carry large repeated state that can safely be represented by a stable identifier, whether producer sends redundant metadata, and whether consumers fetch the same payload repeatedly. Compare payload bytes and operations per completed task.

**Potential savings:** shrink repeated payload fields or avoid redundant enqueue only when source-of-truth lookup and retention semantics remain safe.

**Guardrails:** do not replace durable message data with a pointer whose target may expire or change before consumption. Include compatibility tests for old messages still in flight.

### P2 — Audit scheduled collector work that produces no new data

**Inspect:** scheduled runs by source and outcome; upstream publication cadence; no-change response rate; repeated API calls that return the same source version; retries and rate-limit responses.

**Potential savings:** conditional requests/ETags or source-version checks where the upstream supports them; avoid downstream persistence when source data is unchanged. Consider cadence changes only when an explicit freshness SLA and upstream publication schedule support them.

**Guardrails:** do not raise freshness thresholds or silently skip collection. QQ Music and KKBOX were within configured age limits in the snapshot but can be older than other sources; source-specific requirements must be documented first.

### P2 — Review Cron dispatcher fan-out and subrequests

**Evidence:** recent 60-minute snapshot: dispatcher 63 samples, average CPU 1.49ms/max 5ms and 136 subrequests; Sakurazaka Cron 57 samples, average 2.41ms/max 5ms and 6 subrequests. CPU is low; fan-out counts warrant attribution, not automatic refactoring.

**Inspect:** subrequests per useful action, duplicate dispatches, no-op task executions, repeated metadata reads and whether one event causes overlapping collectors to run.

**Potential savings:** remove a proven duplicate dispatch or reuse already-fetched metadata. Keep task schedules, retries and freshness SLAs intact. Do not repeat #2256.

### P2 — Audit Worker-to-Worker and Pages-to-Worker HTTP hops

**Inspect:** route-level request counts, internal fetches, redirects, payload sizes and whether Pages calls a Worker only to retrieve data already available in an established read model. Distinguish user traffic from scheduled internal traffic.

**Potential savings:** remove proven redundant internal hops or share a result inside one request. Prefer the existing read-model boundary over moving processing back into Pages.

**Guardrails:** preserve auth boundaries, public response semantics, caching correctness, timeouts and deployment independence. Do not add cross-service dependencies that complicate deploy/rollback.

### P3 — Reduce observability diagnostic overhead without reducing coverage

**Evidence:** unified observability run #5157 took 4m23s. Duration alone is GitHub Actions time, not proof of Cloudflare billable usage.

**Inspect:** per-step duration, external API call count, repeated account/deployment/metrics lookups and serial steps that are independent read-only checks.

**Potential savings:** deduplicate identical reads within a run; parallelize independent checks; avoid repeated parsing of the same artifact.

**Guardrails:** do not skip policy gates, reduce sample coverage, reuse stale results across runs or mark missing telemetry healthy. Preserve a clear failure if required evidence is unavailable.

### P3 — Reduce CI-only computation without affecting production runtime

**Inspect:** duplicate test/build work across required workflows, repeated dependency installation, redundant generated-artifact checks and jobs that rerun unchanged expensive setup. Use workflow logs and cache hit rates.

**Potential savings:** share safe dependency caches, scope tests by changed paths only where required coverage remains guaranteed, and remove duplicate builds when artifact provenance is explicit.

**Guardrails:** preserve required checks, reproducibility, lockfile validation, security scans and production deployment gates. CI minutes are separate from Cloudflare resource usage; track them separately.

### P3 — Improve query-plan regression protection

**Inspect:** existing D1 budget regression tests and migrations. Determine whether tests assert query shape/index use or only source text and aggregate budgets.

**Potential savings:** add targeted regression fixtures for known high-row-read queries, query plans and execution counts so a future change cannot silently restore a full-history scan.

**Guardrails:** avoid brittle exact-plan assertions across SQLite versions; assert meaningful access-path or rows-read properties where supported. Do not create production writes just to test diagnostics.

### P3 — Improve diagnostic freshness and status clarity

**Inspect:** stale workflow source commits, report generation timestamps, current-main SHA, missing metrics and the difference between a successful workflow and a healthy production status.

**Potential savings:** prevent duplicate diagnostic jobs when an equivalent run is already active; avoid redundant artifact generation. These save CI overhead, not necessarily Cloudflare usage.

**Guardrails:** stale or unavailable measurements must remain UNKNOWN, not OK. Keep failure precedence for public health and current-main production status.

## 3. Existing optimizations and regression traps

- #2255: avoids full-history aggregation for Spotify latest snapshot dates.
- #2256: reduces idle Sakurazaka Cron CPU without changing collection cadence.
- Latest diagnostic snapshot: no CPU policy violations, no recent errors, public health HTTP 200, 7/7 monitored Workers active.
- D1 same-day read/write pace is UNKNOWN because samples are not comparable.
- D1 storage-size lookup using a placeholder database ID is a separate diagnostic completeness defect, not evidence of production D1 outage.
- R2 is intentionally excluded from this backlog.

## 4. Recommended investigation sequence

1. Fix D1 snapshot comparability.
2. Export top D1 writer and reader fingerprints with execution counts and rows read/written.
3. Attribute Queue operations, retry churn and duplicate enqueue by queue.
4. Profile DO storage operations and CPU with a larger sample.
5. Inspect Spotify source requests and changed-vs-unchanged writes.
6. Attribute Cron dispatcher subrequests and internal HTTP hops.
7. Inspect Observability/CI step durations and duplicate work.
8. Implement one narrowly scoped optimization per PR and measure against a comparable baseline.

## 5. Evidence required before implementation

For every change record:
- baseline window, scope and source;
- query/operation fingerprint and measured cost;
- expected reduction and uncertainty;
- invariants for freshness, completeness, recovery, retry and ordering;
- targeted tests and required CI;
- post-deploy measurement over a comparable window;
- explicit check that health, collection coverage and diagnostics did not regress.

## 6. Not recommended

- Reducing collection cadence or deleting history merely to lower totals.
- Adding D1 writes or Queue messages to make diagnostics appear more complete.
- Treating stale/UNKNOWN values as normal or as proof of savings.
- Removing health, telemetry or recovery checks to shorten workflows.
- Optimizing a query because it looks repetitive in source without production evidence.
- Combining multiple risky runtime changes in one PR.
