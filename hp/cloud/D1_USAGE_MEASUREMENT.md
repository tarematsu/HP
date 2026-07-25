# D1 usage measurement

D1 usage measurement is owned by the unified HP and Stationhead Cloudflare Observability workflow in `.github/workflows/sh-observability.yml`.

`.github/scripts/audit-cloudflare-daily-usage.py` queries Cloudflare for all configured Worker requests, D1 rows read and written, and Queue operations. Partial UTC-day values are projected to 24 hours and checked against the account-wide configured daily budgets.

D1 query-cost insights for both HP and Stationhead databases are collected in the same workflow, and `.github/scripts/publish-cloudflare-observability-status.mjs` maintains one canonical status issue.

Deployment configuration resolution does not query usage or publish a separate status issue. This keeps deployment setup free of duplicate Cloudflare API calls and leaves one canonical usage report in the Observability workflow.
