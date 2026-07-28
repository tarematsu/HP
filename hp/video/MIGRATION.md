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

`homepanel-cloud` is the only HomePanel Worker and public endpoint. Its entry point is `hp/cloud/src/unified_worker.js`.

- `/admin`, `/v1`, and `/v1/*` are handled by the compact HomePanel implementation.
- `/api/*` and static video application requests are authenticated and handled in the same Worker by importing `hp/video/src/entry.js`.
- Browser Rendering, static assets, the manual-import Queue consumer, video collection, video liveness, and video feed coordination are bound directly to `homepanel-cloud`.
- HomePanel scheduling, device synchronization, radar bundle sharding, and video feed coordination retain separate Durable Object classes so one workload cannot block unrelated coordination.
- All runtime paths use the migrated `homepanel-data` D1 database; HomePanel R2 bindings and secrets remain on the unified Worker.
- The `VIDEO_SERVICE` Service Binding and standalone `homepanel-video` Worker are removed.

## Scheduling and bounded work

Video liveness runs in `homepanel-cloud` from one hourly Cron Trigger.

- interval: one hour;
- batch size: five URLs;
- probe: first-byte range request;
- concurrency: five;
- timeout: eight seconds;
- overlap protection: D1 lock.

This produces at most 120 normal liveness probes per day before retries. Automatic source collection remains disabled; only explicit authenticated collection requests run collectors.

HomePanel source refreshes remain owned by `SchedulerCoordinator` alarms. Device-sync cache and radar-bundle shard work use `DeviceSyncCoordinator` and `RadarBundleCoordinator`. Video feed candidate state uses `VideoFeedCoordinator` through the `VIDEO_FEED_COORDINATOR` binding.

## Deployment and rollback

`.github/workflows/cloud-deploy.yml` validates both source workspaces, deploys `homepanel-cloud`, then idempotently deletes any remaining `homepanel-video` Worker deployment.

`.github/workflows/homepanel-cloud-rollback.yml` rolls back only `homepanel-cloud`. Restoring the deleted standalone video Worker is intentionally unsupported.

The legacy `videoscraper` Worker and `twivideo-swiper-db` database remain retired. No tablet URL change is required.
