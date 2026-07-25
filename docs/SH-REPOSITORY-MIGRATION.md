# Stationhead repository migration

Stationhead was imported from `tarematsu/SH` into the root of `tarematsu/HP` without Git history.

- Source branch: `main`
- Source commit: `741ccc82c94a17cbe3f3b57f8b6f180105ee1922`
- Destination layout: repository root (`worker/`, `site/`, `database/`, `packages/`, `scripts/`, `tests/`)

## Active repository-level workflows

- Validation: `.github/workflows/ci.yml`
- Production deployment: `.github/workflows/deploy-split-pipeline.yml`
- Database operations: `.github/workflows/database.yml`
- Observability: `.github/workflows/sh-observability.yml`
- Browser discovery: `.github/workflows/sh-browser-discovery.yml`

There is no nested `SH/` repository or nested workflow directory. GitHub Actions and Cloudflare configuration resolve paths from the HP monorepo root.

## Cutover state

The monorepo is the intended canonical source after PR #256 is merged and its checks pass. Before retiring the original SH repository, verify that required secrets, variables, environment protections, Cloudflare repository links, and operational runbooks all target `tarematsu/HP`.

Deleting or archiving the original SH repository is an operational follow-up and is not performed by the migration pull request.
