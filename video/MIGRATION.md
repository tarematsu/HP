# VP and HomePanel Worker consolidation

This directory is the imported snapshot of `tarematsu/VP`.

- Source commit: `9984a5db4104019a2537a3018aa7b754f9ad4228`
- Imported into HP as: `video/`
- Unified Worker: `homepanel`
- Unified D1 database: `homepanel-data`
- Legacy Workers: `homepanel-cloud` and `videoscraper`
- Legacy video D1 database: `twivideo-swiper-db`

## Runtime boundary

The unified entry point is `cloud/src/unified_worker.js`.

- `/admin`, `/v1`, and `/v1/*` continue to use the existing HomePanel Worker implementation.
- `/api/*` and the static application routes continue to use the existing video implementation.
- Queue and scheduled events are delegated to the video implementation.
- HomePanel keeps its existing `DB`, R2, and Durable Object bindings.
- Video uses the same `DB` binding after its schema and rows are migrated into `homepanel-data`.
- Video assets, Browser Rendering, manual-import queues, and the liveness cron are attached to the unified Worker.

## Required production secret

Create the GitHub Actions production secret `HOMEPANEL_RUNTIME_SECRETS_JSON` before cutover. Its value must be one JSON object containing the current runtime secret values from both legacy Workers, including `ADMIN_TOKEN`, a HomePanel device authentication secret, and a HomePanel action token.

Cloudflare exposes secret names but not existing secret values. The cutover workflow compares the supplied JSON keys with both legacy Workers and refuses to continue when any legacy secret is missing.

## Cutover order

1. Merge and validate the unified Worker changes.
2. Run `Cut over to unified homepanel Worker` manually.
3. The workflow applies pending source video migrations.
4. The legacy `videoscraper` Worker enters `VIDEO_MIGRATION_FREEZE=true`, blocking API, queue, and scheduled writes.
5. The workflow deploys `homepanel` in the same frozen state and applies the unified schema to `homepanel-data`.
6. Each allowlisted video table is exported without schema and imported into `homepanel-data` in dependency order.
7. Row counts, foreign keys, and the D1 schema inventory are verified.
8. The unified Worker is redeployed with video routes active.
9. An authenticated HomePanel refresh wakes the scheduler in the new Durable Object namespace.
10. Migration evidence is retained as a workflow artifact for 90 days.

If the cutover fails before completion, the workflow attempts to unfreeze the legacy `videoscraper` Worker. The source D1 database is not deleted by the cutover workflow.

## Legacy resource retirement

After the cutover workflow succeeds:

1. Run `Retire legacy videoscraper resources` with the successful cutover run ID.
2. That workflow downloads and validates the migration manifest, verifies the active `homepanel` APIs, deletes the legacy `videoscraper` Worker, and deletes `twivideo-swiper-db`.
3. Move every tablet `cloudflareBaseUrl` or the stable custom domain to the new `homepanel` Worker.
4. Run `Retire legacy homepanel-cloud Worker` only after the endpoint move is complete. It verifies a device-authenticated HomePanel API call before deleting `homepanel-cloud`.

The `homepanel-data` D1 database and `homepanel-updates` R2 bucket are reused and must not be deleted during Worker retirement.

Original VP workflows remain under `video/.github/workflows` as historical migration references. Active monorepo workflows belong under the repository root `.github/workflows/` directory.
