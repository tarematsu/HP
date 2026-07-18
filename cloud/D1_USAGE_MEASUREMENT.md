# D1 usage measurement

Cloudflare diagnostics writes `d1-usage-complete-utc-day.json` into its uploaded diagnostics artifact.

The file reports the previous completed UTC calendar day's `rowsRead`, `rowsWritten`, `readQueries`, and `writeQueries` for the D1 database configured as the `DB` binding in `wrangler.jsonc`.

On a main-branch push, the same result updates the repository issue named `D1 complete-day usage report`, preserving an inspectable daily baseline even when workflow artifact retrieval is unavailable.

The measurement runs only in GitHub Actions and does not add a Worker runtime path.
