# Ohisama legacy daily import

The adjacent compressed data module contains one idempotent SQL INSERT generated from the legacy Google Sheet raw `Ohisama` observations. Source timestamps are interpreted as JST; JST 09:00 is UTC 00:00. Spreadsheet annotations and non-numeric error values are ignored. Existing `sh_daily_summary` rows are preserved.
