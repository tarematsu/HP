# Home Platform repository instructions

This repository is `tarematsu/HP`. It is the canonical monorepo for the Stationhead platform at the repository root and HomePanel applications under `hp/`. Product deployments remain independent.

## Repository identity

- Verify repository-scoped work against `tarematsu/HP` and the requested branch or commit.
- Do not infer a repository from an older conversation, another checkout, or a browser tab.
- The local checkout path is not part of repository identity.
- When the user says “this project” or “current Worker”, bind the request to this repository unless they explicitly name another target.

## Layout and ownership

- Stationhead: `worker/`, `site/`, `database/`, `packages/`, `scripts/`, `tests/`
- HomePanel Cloud: `hp/cloud/`
- HomePanel Video: `hp/video/`
- HomePanel Native: `hp/native/`
- Shared GitHub automation: `.github/actions/`, `.github/scripts/`, `.github/workflows/`

Keep Stationhead and HomePanel deployment, migration, release, rollback, and observability boundaries independent. Share implementation only when behavior and security requirements are genuinely common.

## Cloudflare identity

Derive Worker names, D1 databases, Queues, buckets, and bindings from the active configuration files at the current branch or commit.

Stationhead configurations:

- `worker/wrangler.sakurazaka46jp.jsonc`
- `worker/wrangler.buddies-collector.jsonc`
- `worker/wrangler.runtime.jsonc`
- `site/wrangler.jsonc`

HomePanel configurations:

- `hp/cloud/wrangler.jsonc`
- `hp/video/wrangler.jsonc`

Treat resources absent from those active configurations as outside this repository unless the user explicitly requests a cross-repository comparison.

## Deployment ownership

- GitHub Actions is the supported production build and deployment path.
- Stationhead production deployment is owned by `.github/workflows/deploy-split-pipeline.yml`.
- HomePanel Cloud deployment is owned by `.github/workflows/cloud-deploy.yml`.
- HomePanel Native and Video use their dedicated repository-level workflows.
- Pull requests may validate and bundle code but must not deploy production resources.
- Do not add Cloudflare Git polling or Cloudflare-managed repository deployments.

## Metrics and production diagnostics

For Worker requests, CPU, D1 rows, storage, or other production metrics:

1. Confirm repository, branch, and commit.
2. Resolve active resources from current configuration files.
3. Use repository-owned Cloudflare APIs, Actions runs, artifacts, or status issues as evidence.
4. Label values as actual, estimated, extrapolated, or unavailable, with the measurement window and timestamp.
5. Reject metrics whose resource identity does not match the active configuration.
6. Never display tokens, account IDs, database IDs, cookies, or other secrets.

## Change discipline

- Prefer responsibility-specific files and importable modules over dynamic loading or duplicated implementations.
- Keep workflows declarative; move substantial validation or orchestration logic into tested scripts or actions.
- Preserve existing production boundaries while reducing duplicated code.
- Run the narrowest relevant checks first, then the repository-level validation required by the changed paths.
