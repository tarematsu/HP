# Home Platform monorepo

## Layout

- `worker/`, `site/`, `database/`, `packages/`: Stationhead platform
- `hp/cloud/`: HomePanel Cloud Worker and D1 schema
- `hp/video/`: HomePanel Video Worker and site
- `hp/native/`: HomePanel Windows application
- `.github/actions/`: reusable GitHub Actions shared across products
- `.github/scripts/`: shared Cloudflare diagnostics and budget tooling

## Deployment boundaries

The repository is unified, but production ownership is not.

- Stationhead production: `.github/workflows/deploy-split-pipeline.yml`
- HomePanel Cloud production: `.github/workflows/cloud-deploy.yml`
- Stationhead observability: `.github/workflows/sh-observability.yml`
- HomePanel observability: `.github/workflows/hp-observability.yml`
- Database migrations, releases, rollbacks, and credentials remain product-specific.

## Shared operational components

- `.github/actions/cloudflare-context/`: exports the API token and resolves exactly one accessible account.
- `.github/actions/cloudflare-observability-diagnostics/`: runs persisted telemetry queries and Live Tail collection in parallel.
- `.github/scripts/audit-cloudflare-daily-usage.py`: projects daily Worker, D1, and Queue usage.
- `.github/scripts/audit-cloudflare-telemetry.py`: evaluates persisted and live Worker telemetry.
- `.github/scripts/capture-cloudflare-live-tail.mjs`: captures and sanitizes Live Tail events.
- `.github/scripts/query-cloudflare-observability.py`: queries persisted Cloudflare telemetry.

Shared components contain common mechanics only. Product-specific budgets, Worker names, publishing, and deployment decisions stay in their product workflows.

## Validation

- `npm run check`: repository-level validation
- `npm run check:sh`: Stationhead validation
- `npm run check:hp-cloud`: HomePanel Cloud validation
- `npm run check:hp-video`: HomePanel Video validation
- `.github/workflows/native-windows-build.yml`: HomePanel Native build and static analysis
