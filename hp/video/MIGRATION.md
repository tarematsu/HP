# HomePanel video service architecture

This directory is the imported snapshot of `tarematsu/VP` and is maintained entirely inside HP.

- Source commit: `9984a5db4104019a2537a3018aa7b754f9ad4228`
- Imported into HP as: `hp/video/`
- Public gateway Worker: `homepanel-cloud`
- Private video Worker: `homepanel-video`
- Shared D1 database: `homepanel-data`
- Retired legacy Worker: `videoscraper`
- Retired legacy D1 database: `twivideo-swiper-db`

Deleting the former VP repository does not remove any runtime source or production dependency used by HP.

## Runtime boundary

`homepanel-cloud` is the only public HomePanel endpoint. Its entry point is `hp/cloud/src/unified_worker.js`.

- `/admin`, `/v1`, and `/v1/*` are handled directly by the compact HomePanel implementation.
- `/api/*` and static video application requests are authenticated at the gateway and forwarded through the `VIDEO_SERVICE` Service Binding.
- `homepanel-video` has `workers_dev` and preview URLs disabled and rejects requests that do not carry the internal gateway marker.
- Browser Rendering, static assets, the manual-import Queue consumer, video collection, video liveness, and video feed coordination belong only to `homepanel-video`.
- HomePanel scheduling, device synchronization, and radar bundle sharding use separate Durable Object classes so one workload cannot block unrelated coordination.
- Both Workers use the migrated `homepanel-data` D1 database; the gateway retains HomePanel R2 bindings and secrets.
- The old D1 activation marker and migration-freeze runtime branches were removed after cutover completion.

## Scheduling and bounded work

Video liveness runs in the private video Worker from one hourly Cron Trigger.

- interval: one hour;
- batch size: five URLs;
- probe: first-byte range request;
- concurrency: five;
- timeout: eight seconds;
- overlap protection: D1 lock.

This produces at most 120 normal liveness probes per day before retries. Automatic source collection remains disabled; only explicit authenticated collection requests run collectors.

HomePanel source refreshes remain owned by `SchedulerCoordinator` alarms. Device-sync cache and radar-bundle shard work use `DeviceSyncCoordinator` and `RadarBundleCoordinator`. Video feed candidate state uses `VideoFeedCoordinator` in the private video Worker.

## Deployment and rollback

`.github/workflows/cloud-deploy.yml` validates both services, deploys `homepanel-video` first, then deploys `homepanel-cloud`, and can verify the authenticated `/v1/ready` endpoint. Deploying the target first prevents the Service Binding from pointing to a missing Worker.

`.github/workflows/homepanel-cloud-rollback.yml` rolls back the private video service first and the public gateway second. Optional explicit version IDs are supported; otherwise Wrangler selects the previous deployment.

The legacy `videoscraper` Worker and `twivideo-swiper-db` database remain retired. No tablet URL change is required.
