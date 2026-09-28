# Pages API gateway

All public HTTP APIs are owned by Cloudflare Pages under `/api`.

The Workers have public URLs disabled. `sh-runtime-orchestrator` owns collection, persistence, metadata, Pages read-model publication, and every other non-Sakurazaka scheduled or Queue lane. `sh-sakurazaka46jp` remains isolated for official-news-driven raw collection and per-minute raw materialization.

Use `GET /api` for the machine-readable endpoint catalog. The public API surface is:

- `GET /api/health`
- `GET /api/sakurazaka46jp-status`
- `GET /api/dashboard`
- `GET /api/dashboard-details`
- `GET /api/history`
- `GET /api/history-current`
- `GET /api/track-history`
- `GET /api/sakurazaka46jp`
- `GET /api/host-history`
- `GET /api/first-week-comparison`
- `GET /api/spotify-playcounts`

`/api/health` is the single aggregate health endpoint. It combines collector, minute pipeline, runtime scheduler, official-news, and Sakurazaka raw-materializer health into one response and one HTTP status. `/api/sakurazaka46jp-status` is the focused latest per-minute Sakurazaka collection status.

`/api/dashboard` is the fast first-paint payload: current state, queue, playback state, goal data, and current metrics. The public materialized dashboard model is generated with `history=0` so first paint never waits for 24-hour chart history. `/api/dashboard-details?channel_id=...` supplies the deferred current 24-hour series, previous-day comparison series, five-minute stream-growth series, and completed UTC-day summaries. The browser loads those details after the critical dashboard payload and caches them separately.

`track-history` includes track like data and the latest all-time ranking. `sakurazaka46jp` provides official broadcast listener series. Historical and comparison APIs are read-only and are listed in the machine-readable catalog.

Removed endpoints do not have compatibility handlers or catalog entries. File absence is the public 404 boundary.

The canonical groups are defined in `site/functions/lib/api-contract.js`. Tests enforce that every JavaScript file under `site/functions/api` corresponds to one declared public route, including the API index. There is no API middleware route allow-list; the shared Pages middleware owns cache/materialized-response policy.

Collection and Sakurazaka raw-derived session persistence are private modules under `site/functions/lib` and `worker/src`. Workers call those modules directly; there are no Pages ingestion routes.

Do not add public HTTP routes to Worker entrypoints. Add new public read endpoints to `site/functions/api`, register them in the shared API contract, and bind their data sources in `site/wrangler.jsonc`.
