# HomePanel video runtime architecture

This directory is the imported snapshot of `tarematsu/VP` and is maintained entirely inside HP.

- Source commit: `9984a5db4104019a2537a3018aa7b754f9ad4228`
- Imported into HP as: `hp/video/`
- Production Worker: `homepanel-cloud`
- Shared D1 database: `homepanel-data`
- Deleted standalone Worker: `homepanel-video`
- Retired legacy Worker: `videoscraper`
- Retired legacy D1 database: `twivideo-swiper-db`

Deleting the former VP repository does not remove any runtime source or production dependency used by HP.

## Runtime boundary

`homepanel-cloud` is the only HomePanel application Worker and public endpoint. Its entry point is `hp/cloud/src/unified_worker.js`. Cron ownership is externalized to the repository-wide lightweight `sh-cron-dispatcher` Worker.

- `/admin`, `/v1`, and `/v1/*` are handled by the compact HomePanel implementation.
- `/api/*` and static video application requests are authenticated and handled in the same Worker by importing `hp/video/src/entry.js`.
- Browser Rendering, static assets, the manual-import Queue consumer, video collection, video liveness, and video feed coordination are bound directly to `homepanel-cloud`.
- HomePanel scheduling, device synchronization, radar bundle sharding, and video feed coordination retain separate Durable Object classes so one workload cannot block unrelated coordination.
- All runtime paths use the migrated `homepanel-data` D1 database; HomePanel R2 bindings and secrets remain on the unified Worker.
- The `VIDEO_SERVICE` Service Binding and standalone `homepanel-video` Worker are removed.

## Scheduling and bounded work

The generic `sh-cron-dispatcher` owns the Cron Trigger and wakes the existing HomePanel Durable Objects once per hour. `homepanel-cloud` itself has no Cron Trigger.

- interval: one hour;
- batch size: five URLs;
- probe: first-byte range request;
- concurrency: five;
- timeout: eight seconds;
- overlap protection: D1 lock.

This produces at most 120 normal liveness probes per day before retries. Automatic source collection remains disabled; only explicit authenticated collection requests run collectors.

HomePanel source refreshes remain owned by `SchedulerCoordinator` alarms. Device-sync cache and radar-bundle shard work use `DeviceSyncCoordinator` and `RadarBundleCoordinator`. Video feed candidate state uses `VideoFeedCoordinator` through the `VIDEO_FEED_COORDINATOR` binding. The shared Cron Worker only dispatches to these coordinators; it does not hold HomePanel D1, R2, Queue, Browser, or asset bindings.

## Deployment and rollback

`.github/workflows/cloud-deploy.yml` validates both source workspaces, deploys `homepanel-cloud`, then idempotently deletes any remaining `homepanel-video` Worker deployment. The generic dispatcher is deployed by the Stationhead production workflow because it also owns shared music-service scheduling.

`.github/workflows/homepanel-cloud-rollback.yml` rolls back only `homepanel-cloud`. Restoring the deleted standalone video Worker is intentionally unsupported.

The legacy `videoscraper` Worker and `twivideo-swiper-db` database remain retired. No tablet URL change is required.
