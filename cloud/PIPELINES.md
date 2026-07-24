# HomePanel Pipelines

HomePanel emits compact operational events to a Cloudflare Pipelines stream and keeps R2 as the durable storage tier.

## Provisioning

From `cloud/`, authenticate Wrangler and run:

```bash
npm install
HOMEPANEL_PIPELINE_BUCKET=<existing-r2-bucket-name> npm run setup:pipeline
```

The setup script creates or reuses:

- stream: `homepanel_events_stream`
- R2 sink: `homepanel_events_sink`
- pipeline: `homepanel_events`
- Parquet output compressed with zstd under `homepanel/events/`

It then writes the exact stream ID to the `HOMEPANEL_PIPELINE` binding in `wrangler.jsonc`. Review that change before deploying.

## Events

- `homepanel_telemetry`: compact device environment samples
- `video_liveness_checkpoint`: daily or transition/error liveness checkpoints
- `video_feed_snapshot`: playback-feed snapshot publication metadata

R2 objects used by the application remain independent of the Pipelines sink. If a Pipeline send fails, telemetry and playback continue through their R2/DO paths; the failure is logged and does not block the primary request.

## Budget

The CI budget assumes six telemetry uploads per day, up to 60 samples per upload, plus low-frequency feed and liveness events. At a conservative 1 KiB per event this remains below 12 MiB per 31-day month, well below a 1 GiB monthly transform/sink allowance.
