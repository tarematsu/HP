# Telemetry history fast path

For the normal single-device case, telemetry history is incrementally merged from the existing `environment` state instead of rereading every retained five-minute bucket from D1.

The durable `environment_buckets` scan remains the recovery path when state is missing, malformed, multi-device, unordered, or changed concurrently.

This removes the steady-state D1 row scan without adding a network request or scheduler work.
