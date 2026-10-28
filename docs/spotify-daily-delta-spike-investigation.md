# Spotify daily-delta spike investigation

## Symptom

The Spotify Pages view for 乃木坂46 showed an approximately -11 million then +11 million daily-delta spike around 2026-10-26/27, while the latest displayed daily change was +294,162. Treat this as a data-integrity incident until proven otherwise.

## Investigation plan

1. Trace the complete data path: Spotify source payload -> album candidates -> daily finalization in D1 -> artist daily summaries -> published Pages read model -> graph rendering.
2. Inspect the affected dates and adjacent dates for tracks whose observed playcount became zero, regressed, disappeared, changed canonical identity, or rebounded the next day. Compare raw per-track values, delta, artist total_delta, and the published read model.
3. Review the existing historical-spike repair (PR #2274) and prior safeguards. Determine whether the repair was not merged/run, did not include the affected dates, or left another producer/reader path vulnerable.
4. Reproduce the negative/positive spike with a focused regression test, including zero-count observations, missing/baseline-less tracks, aliases, and daily aggregate refresh.
5. Fix the source of the corruption rather than hiding/clamping the graph. Preserve legitimate Spotify corrections while preventing million-scale false deltas from transient invalid observations.
6. Repair only affected historical rows using the production finalization logic, if a safe guarded repair path exists. Avoid adding recurring D1 reads/writes.
7. Validate unit tests, Worker tests, read-model tests, CI/browser audit, and verify the published graph/read-model no longer contains the outlier.

## Acceptance criteria

- No unexplained multi-million daily-delta outlier remains for the affected artist/date range.
- A zero or invalid playcount observation cannot produce a false lifetime-sized negative delta and next-day positive rebound.
- Genuine downward corrections remain representable.
- Regression tests fail on the observed defect and pass with the fix.
- The repair is date-scoped, repeat-safe, and does not add recurring resource usage.

## Initial status

Investigation started. Root cause, affected rows, and production repair outcome are not yet confirmed. Do not consider the issue resolved until the source data and published read model are checked.
