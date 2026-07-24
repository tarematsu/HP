# Home Platform monorepo

## Layout

- `worker/`, `site/`, `database/`, `packages/`: Stationhead platform
- `hp/cloud/`, `hp/video/`, `hp/native/`: HomePanel applications
- `.github/scripts/`: shared Cloudflare observability and budget tooling
- `.github/actions/cloudflare-context/`: token export and automatic account discovery

## Deployment boundaries

SH and HP retain independent Workers, D1 migrations, release workflows, and rollback paths. The repository is unified; production deployments are not.

## Canonical common scripts

Where both repositories contained the same Cloudflare operational filename, the HP root implementation was retained as the canonical shared implementation. SH-only scripts were promoted unchanged.

Duplicate filenames resolved in favor of the canonical root implementation:

- `audit-cloudflare-daily-usage.py`
- `audit-cloudflare-telemetry.py`
- `capture-cloudflare-live-tail.mjs`
- `query-cloudflare-observability.py`
