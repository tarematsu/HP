# SH repository migration

This directory is a history-free snapshot imported from `tarematsu/SH`.

- Source branch: `main`
- Source commit: `741ccc82c94a17cbe3f3b57f8b6f180105ee1922`
- Active validation workflow: `.github/workflows/sh-ci.yml`

The original SH workflows are retained under `SH/.github/workflows` as migration source material. GitHub does not execute nested workflow files.

## Cutover requirements

Before deleting the original SH repository:

1. Merge this pull request and confirm `SH CI` succeeds.
2. Copy the required SH repository secrets, variables, and environment protection rules into the HP repository.
3. Promote and path-adjust the required deployment, database, observability, and scheduled workflows from `SH/.github/workflows` into the repository-level `.github/workflows` directory.
4. Confirm the Cloudflare Pages/Workers deployment configuration uses the HP repository and the `SH/` working directory where applicable.

Deployment and scheduled SH workflows are intentionally not activated by this import because repository-scoped secrets cannot be copied through Git and activating them before cutover could target the wrong HP credentials or fail with missing secrets.
