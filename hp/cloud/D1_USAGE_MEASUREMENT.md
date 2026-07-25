# D1 usage measurement

D1 usage measurement is owned by the HomePanel Cloudflare Observability workflow in `.github/workflows/hp-observability.yml`.

`.github/scripts/audit-cloudflare-daily-usage.py` queries Cloudflare for Worker requests, D1 rows read and written, and Queue operations. Partial UTC-day values are projected to 24 hours and checked against the configured daily budgets.

Deployment configuration resolution does not query usage or publish a separate status issue. This keeps deployment setup free of duplicate Cloudflare API calls and leaves one canonical usage report in the Observability workflow.
