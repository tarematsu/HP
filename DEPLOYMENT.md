# Deployment policy

Production deployments for `homepanel-cloud` run only through GitHub Actions.

## Allowed deployment path

- `.github/workflows/cloud-deploy.yml`
- Manual cutover and retirement workflows under `.github/workflows/`
- Wrangler commands executed inside those GitHub Actions jobs

## Disabled deployment path

Cloudflare Workers Builds must not be connected to the `tarematsu/HP` repository. Production and preview Git triggers have been removed from Cloudflare.

`cloud-deploy.yml` runs `.github/scripts/assert-actions-only-cloudflare.mjs` before every deployment. The job fails closed if a Cloudflare Workers Builds trigger connected to `tarematsu/HP` is found.

Do not reconnect the repository from **Cloudflare Dashboard > Workers & Pages > homepanel-cloud > Settings > Builds**. Pull requests and pushes are validated by GitHub Actions; Cloudflare does not build directly from Git.
