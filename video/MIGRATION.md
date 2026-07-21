# VP and HomePanel Worker consolidation

This directory is the imported snapshot of `tarematsu/VP`.

- Source commit: `9984a5db4104019a2537a3018aa7b754f9ad4228`
- Imported into HP as: `video/`
- Unified Worker: `homepanel-cloud`
- Unified D1 database: `homepanel-data`
- Legacy video Worker: `videoscraper`
- Legacy video D1 database: `twivideo-swiper-db`

## Runtime boundary

The unified entry point is `cloud/src/unified_worker.js`.

- `/admin`, `/v1`, and `/v1/*` continue to use the existing HomePanel Worker implementation.
- `/api/*` and the static application routes continue to use the existing video implementation.
- Queue and scheduled events are delegated to the video implementation after migration activation.
- HomePanel keeps its existing Worker name, URL, secrets, `DB`, R2, and Durable Object namespace.
- Video uses the same `DB` binding after its schema and rows are migrated into `homepanel-data`.
- Video assets, Browser Rendering, manual-import queues, and the liveness cron are attached to `homepanel-cloud`.
- A D1 activation flag keeps video fetch, queue, and scheduled handlers disabled until the verified data import completes.
- Cloudflare-managed production builds fail closed and skip deployment until that activation flag is set, so merging alone cannot transfer the Queue consumer prematurely.

## Required production secret

Set `ADMIN_TOKEN` directly on the existing `homepanel-cloud` Worker before cutover.

The cutover checks that the secret name exists but never reads or copies its value. Existing HomePanel secrets remain attached to `homepanel-cloud` because the Worker is updated in place with `keep_vars` enabled.

## Cutover order

1. Merge and validate the in-place consolidation changes.
2. Set `ADMIN_TOKEN` on `homepanel-cloud`.
3. Run `Migrate videoscraper into homepanel-cloud` manually.
4. The workflow applies pending source video migrations and the target activation migration.
5. The target video runtime is marked inactive.
6. The legacy `videoscraper` Worker enters `VIDEO_MIGRATION_FREEZE=true`, blocking API, queue, and scheduled writes.
7. The single Queue push consumer is detached from `videoscraper` or an abandoned `homepanel` Worker.
8. Any abandoned Worker named `homepanel` from the discarded rename plan is removed.
9. Unified code is deployed to the existing `homepanel-cloud` Worker, which becomes the Queue consumer. Existing HomePanel routes remain live while video routes return 503 until activation.
10. The target video tables in `homepanel-data` are reset without touching HomePanel tables.
11. Each allowlisted videoscraper table is exported without schema and imported in dependency order.
12. Row counts, foreign keys, and the D1 schema inventory are verified.
13. The D1 activation flag is set and the video routes, queue, and cron become active on `homepanel-cloud`.
14. Migration evidence is retained as a workflow artifact for 90 days.

If the cutover fails, the workflow deactivates the unified video runtime, detaches the `homepanel-cloud` Queue consumer, and then attempts to redeploy and unfreeze `videoscraper`. The source D1 database is not deleted by the cutover workflow.

## Legacy resource retirement

After the cutover workflow succeeds:

1. Run `Retire legacy videoscraper resources` with the successful migration run ID.
2. That workflow validates the migration manifest, verifies the active HomePanel and video routes on `homepanel-cloud`, deletes `videoscraper`, and deletes `twivideo-swiper-db`.

No tablet URL change is required. `homepanel-cloud`, `homepanel-data`, `homepanel-updates`, existing HomePanel secrets, and the scheduler Durable Object namespace are retained.

Original VP workflows remain under `video/.github/workflows` as historical migration references. Active monorepo workflows belong under the repository root `.github/workflows/` directory.
