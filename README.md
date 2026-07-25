# Home Platform

Canonical monorepo for Stationhead (SH) and HomePanel (HP).

- Stationhead application and data pipeline: repository root (`worker/`, `site/`, `database/`, `packages/`)
- HomePanel applications: `hp/cloud/`, `hp/video/`, `hp/native/`
- Shared Cloudflare account resolution: `.github/actions/cloudflare-context/`
- Shared persisted-telemetry and Live Tail diagnostics: `.github/actions/cloudflare-observability-diagnostics/`
- Shared operational tooling: `.github/scripts/`

Production deployments, migrations, releases, rollbacks, and observability remain independent for SH and HP.

Run `npm run check` for repository-level validation. See `docs/MONOREPO.md` for ownership and deployment boundaries.
