# Cloudflare build diagnostics

The `Cloudflare build diagnostics` workflow watches the Cloudflare Workers Build for the exact Git commit and retrieves sanitized logs through the Workers Builds API.

Required GitHub repository secret:

- `CLOUDFLARE_BUILDS_API_TOKEN`

The workflow resolves the Cloudflare account ID and Worker name from `cloud/wrangler.jsonc` plus the provided API token. The API token must be a user-scoped Cloudflare API token capable of reading Workers Builds and listing Worker scripts. Do not use a build token UUID or store the token in repository files.

Automatic diagnostics run only for relevant pushes to `main`; pull-request branch pushes do not start GitHub Actions. A manual `workflow_dispatch` run may target another ref. When a failed commit belongs to an open PR, the failure report is posted or updated there; otherwise a GitHub issue is created. The full sanitized log is retained as a GitHub Actions artifact for 14 days.
