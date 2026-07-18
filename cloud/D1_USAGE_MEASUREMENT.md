# D1 usage measurement

Cloudflare PR diagnostics writes `d1-usage-complete-utc-day.json` into its uploaded diagnostics artifact.

The file reports the previous completed UTC calendar day's `rowsRead`, `rowsWritten`, `readQueries`, and `writeQueries` for the D1 database configured as the `DB` binding in `wrangler.jsonc`.

The measurement runs only in GitHub Actions and does not add a Worker runtime path.
